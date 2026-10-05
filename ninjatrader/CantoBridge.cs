#region Using declarations
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NinjaTrader.Cbi;
using NinjaTrader.Data;
using NinjaTrader.NinjaScript;
#endregion

// ─────────────────────────────────────────────────────────────────────────────
//  CΛNTO Bridge — AddOn NinjaTrader 8
//
//  Journalise chaque exécution (tous les comptes connectés) dans
//      Documents\NinjaTrader 8\export\CANTO\executions-AAAA-MM-JJ.csv
//  avec exactement les colonnes de l'export « Executions » de NinjaTrader, en
//  culture invariante (virgule comme séparateur, point décimal, date ISO).
//  Le desk CΛNTO surveille ce dossier, apparie les exécutions en trades (FIFO)
//  et met le journal à jour à la volée. Aucune donnée ne quitte la machine.
//
//  Installation : copier ce fichier dans Documents\NinjaTrader 8\bin\Custom\AddOns\
//  puis NinjaScript Editor › Compile (F5). L'AddOn démarre avec la plateforme.
// ─────────────────────────────────────────────────────────────────────────────
namespace NinjaTrader.NinjaScript.AddOns
{
    public class CantoBridge : AddOnBase
    {
        private const string Header = "Instrument,Action,Quantity,Price,Time,ID,E/X,Position,Order ID,Name,Commission,Rate,Account,Connection";
        static readonly string AccountFilter = "";
        private static readonly object Sync = new object();
        private readonly HashSet<string> written = new HashSet<string>();
        private readonly HashSet<Account> subscribed = new HashSet<Account>();
        private readonly Dictionary<string, LiveSub> liveSubs = new Dictionary<string, LiveSub>();
        private string folder;
        private int wsPort = 48231;
        private string wsToken = "";
        private ClientWebSocket socket;
        private CancellationTokenSource socketCts;
        private int reconnectDelayMs = 1000;
        private Timer heartbeatTimer;
        private Timer accountsTimer;
        private int rpcSeq;
        private readonly object sendLock = new object();
        // Politique d'ordres lue dans bridge.json (écrit par le desk) : la garde propre de l'AddOn.
        private const int DefaultMaxContracts = 20;
        private readonly object policyLock = new object();
        private readonly List<string> extraAccounts = new List<string>();
        private int maxContracts = DefaultMaxContracts;
        // Défi-réponse (protocole 2) : le jeton ne circule pas ; rien n'est envoyé ni exécuté avant la preuve du desk.
        private volatile bool deskVerified;
        private int connectionGen;
        private string serverNonce;
        private string clientNonce;
        private bool warnedUnverified;
        private Task authWatchdog;

        protected override void OnStateChange()
        {
            if (State == State.SetDefaults)
            {
                Name = "CΛNTO Bridge";
                Description = "Écrit les exécutions dans Documents\\NinjaTrader 8\\export\\CANTO pour le desk CΛNTO.";
            }
            else if (State == State.Configure)
            {
                try
                {
                    folder = Path.Combine(Core.Globals.UserDataDir, "export", "CANTO");
                    Directory.CreateDirectory(folder);
                    LoadSeen();
                }
                catch (Exception ex)
                {
                    Log("CΛNTO Bridge : dossier inaccessible — " + ex.Message, LogLevel.Error);
                    return;
                }

                lock (Account.All)
                {
                    foreach (Account account in Account.All)
                        Subscribe(account);
                }
                Account.AccountStatusUpdate += OnAccountStatusUpdate;
                ReadBridgeConfig();
                StartSocket();
                Log("CΛNTO Bridge actif → " + folder, LogLevel.Information);
            }
            else if (State == State.Terminated)
            {
                StopSocket();
                Account.AccountStatusUpdate -= OnAccountStatusUpdate;
                lock (subscribed)
                {
                    foreach (Account account in subscribed)
                    {
                        account.ExecutionUpdate -= OnExecutionUpdate;
                        account.OrderUpdate -= OnOrderUpdate;
                        account.PositionUpdate -= OnPositionUpdate;
                        account.AccountItemUpdate -= OnAccountItemUpdate;
                    }
                    subscribed.Clear();
                }
                lock (liveSubs)
                {
                    foreach (LiveSub sub in liveSubs.Values) Release(sub);
                    liveSubs.Clear();
                }
            }
        }

        private void Subscribe(Account account)
        {
            if (account == null) return;
            lock (subscribed)
            {
                if (!subscribed.Add(account)) return;
                account.ExecutionUpdate += OnExecutionUpdate;
                account.OrderUpdate += OnOrderUpdate;
                account.PositionUpdate += OnPositionUpdate;
                account.AccountItemUpdate += OnAccountItemUpdate;
            }
            // Rattrapage : exécutions déjà présentes pour la session courante.
            try
            {
                lock (account.Executions)
                {
                    foreach (Execution execution in account.Executions)
                        Write(execution, execution.MarketPosition, execution.Quantity, execution.Price, execution.Time, execution.ExecutionId);
                }
            }
            catch (Exception ex)
            {
                Log("CΛNTO Bridge : rattrapage impossible (" + account.Name + ") — " + ex.Message, LogLevel.Warning);
            }
        }

        private void OnAccountStatusUpdate(object sender, AccountStatusEventArgs e)
        {
            if (e.Status == ConnectionStatus.Connected)
                Subscribe(e.Account);
        }

        private void OnExecutionUpdate(object sender, ExecutionEventArgs e)
        {
            try
            {
                Write(e.Execution, e.MarketPosition, e.Quantity, e.Price, e.Time, e.ExecutionId);
                SendExecution(e.Execution, e.MarketPosition, e.Quantity, e.Price, e.Time, e.ExecutionId);
            }
            catch (Exception ex)
            {
                Log("CΛNTO Bridge : écriture impossible — " + ex.Message, LogLevel.Error);
            }
        }

        private void LoadSeen()
        {
            if (string.IsNullOrEmpty(folder) || !Directory.Exists(folder)) return;
            lock (written)
            {
                foreach (string path in Directory.GetFiles(folder, "executions-*.seen.txt"))
                {
                    try
                    {
                        foreach (string line in File.ReadAllLines(path))
                        {
                            string id = line.Trim();
                            if (id.Length > 0) written.Add(id);
                        }
                    }
                    catch (Exception ex)
                    {
                        Log("CΛNTO Bridge : lecture .seen impossible — " + ex.Message, LogLevel.Warning);
                    }
                }
            }
        }

        private void Write(Execution execution, MarketPosition marketPosition, int quantity, double price, DateTime time, string executionId)
        {
            if (execution == null || string.IsNullOrEmpty(folder) || string.IsNullOrEmpty(executionId)) return;
            string account = execution.Account != null ? execution.Account.Name : "";
            if (!string.IsNullOrEmpty(AccountFilter) && account != AccountFilter) return;

            if (marketPosition == MarketPosition.Flat)
            {
                Log("CΛNTO Bridge : exécution ignorée (position Flat) " + executionId, LogLevel.Warning);
                return;
            }
            if (marketPosition != MarketPosition.Long && marketPosition != MarketPosition.Short)
            {
                Log("CΛNTO Bridge : exécution ignorée (position inconnue) " + executionId, LogLevel.Warning);
                return;
            }

            lock (written)
            {
                if (!written.Add(executionId)) return;
            }

            CultureInfo inv = CultureInfo.InvariantCulture;
            string instrument = execution.Instrument != null ? execution.Instrument.FullName : "";
            string action = marketPosition == MarketPosition.Long ? "Buy" : "Sell";
            string entryExit = execution.IsEntry ? "Entry" : (execution.IsExit ? "Exit" : "");
            string orderId = execution.Order != null ? execution.Order.OrderId : "";
            string orderName = execution.Order != null ? execution.Order.Name : execution.Name;
            string connection = "";
            try
            {
                if (execution.Account != null && execution.Account.Connection != null && execution.Account.Connection.Options != null)
                    connection = execution.Account.Connection.Options.Name;
            }
            catch { /* connexion indisponible */ }

            StringBuilder line = new StringBuilder();
            line.Append(Csv(instrument)).Append(',')
                .Append(action).Append(',')
                .Append(quantity.ToString(inv)).Append(',')
                .Append(price.ToString("0.00######", inv)).Append(',')
                .Append(time.ToString("yyyy-MM-dd HH:mm:ss", inv)).Append(',')
                .Append(Csv(executionId)).Append(',')
                .Append(entryExit).Append(',')
                .Append('-').Append(',')
                .Append(Csv(orderId)).Append(',')
                .Append(Csv(orderName)).Append(',')
                .Append(execution.Commission.ToString("0.00", inv)).Append(',')
                .Append(execution.Rate.ToString(inv)).Append(',')
                .Append(Csv(account)).Append(',')
                .Append(Csv(connection));

            string stamp = time.ToString("yyyy-MM-dd", inv);
            string file = Path.Combine(folder, "executions-" + stamp + ".csv");
            string tmp = file + ".tmp";
            string seen = Path.Combine(folder, "executions-" + stamp + ".seen.txt");
            string seenTmp = seen + ".tmp";
            lock (Sync)
            {
                try
                {
                    List<string> lines = new List<string>();
                    if (File.Exists(file)) lines.AddRange(File.ReadAllLines(file));
                    if (lines.Count == 0) lines.Add(Header);
                    lines.Add(line.ToString());
                    File.WriteAllLines(tmp, lines, new UTF8Encoding(false));
                    // net48, pas l'overload 3 args (File.Move(src, dest, overwrite) est .NET Core / 5+).
                    if (File.Exists(file)) File.Delete(file);
                    File.Move(tmp, file);

                    List<string> seenLines = new List<string>();
                    if (File.Exists(seen)) seenLines.AddRange(File.ReadAllLines(seen));
                    seenLines.Add(executionId);
                    File.WriteAllLines(seenTmp, seenLines, new UTF8Encoding(false));
                    if (File.Exists(seen)) File.Delete(seen);
                    File.Move(seenTmp, seen);
                }
                catch
                {
                    lock (written) { written.Remove(executionId); }
                    try { if (File.Exists(tmp)) File.Delete(tmp); } catch { /* tmp */ }
                    try { if (File.Exists(seenTmp)) File.Delete(seenTmp); } catch { /* tmp */ }
                    throw;
                }
            }
        }

        private void ReadBridgeConfig()
        {
            try
            {
                string path = Path.Combine(folder, "bridge.json");
                if (!File.Exists(path)) return;
                JObject obj = JObject.Parse(File.ReadAllText(path));
                if (obj["port"] != null) wsPort = (int)obj["port"];
                if (obj["token"] != null) wsToken = (string)obj["token"];
                // Absents (bridge.json d'un desk antérieur) : comptes Sim seulement, 20 contrats.
                List<string> extra = new List<string>();
                JArray list = obj["extraAccounts"] as JArray;
                if (list != null)
                {
                    foreach (JToken item in list)
                    {
                        string name = (string)item;
                        if (!string.IsNullOrEmpty(name) && name.Length <= 128) extra.Add(name);
                    }
                }
                int cap = DefaultMaxContracts;
                if (obj["maxContractsPerOrder"] != null)
                {
                    int n = (int)obj["maxContractsPerOrder"];
                    if (n >= 1 && n <= 1000) cap = n;
                }
                lock (policyLock)
                {
                    extraAccounts.Clear();
                    extraAccounts.AddRange(extra);
                    maxContracts = cap;
                }
            }
            catch (Exception ex)
            {
                Log("CΛNTO Bridge : bridge.json illisible — " + ex.Message, LogLevel.Warning);
            }
        }

        private void StartSocket()
        {
            StopSocket();
            socketCts = new CancellationTokenSource();
            Task.Run(() => ConnectLoop(socketCts.Token));
        }

        private void StopSocket()
        {
            if (heartbeatTimer != null) heartbeatTimer.Dispose();
            if (accountsTimer != null) accountsTimer.Dispose();
            heartbeatTimer = null;
            accountsTimer = null;
            if (socketCts != null) socketCts.Cancel();
            ClientWebSocket current = socket;
            socket = null;
            if (current != null)
            {
                try { current.Abort(); } catch { /* fermeture */ }
                current.Dispose();
            }
        }

        private async Task ConnectLoop(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                ReadBridgeConfig();
                if (string.IsNullOrEmpty(wsToken))
                {
                    await Task.Delay(reconnectDelayMs, ct).ContinueWith(_ => { });
                    reconnectDelayMs = Math.Min(reconnectDelayMs * 2, 30000);
                    continue;
                }
                ClientWebSocket ws = new ClientWebSocket();
                try
                {
                    // Pas de jeton dans l'URL : le desk envoie un défi, chacun prouve qu'il connaît le jeton.
                    Uri uri = new Uri("ws://127.0.0.1:" + wsPort.ToString(CultureInfo.InvariantCulture) + "/?v=2");
                    deskVerified = false;
                    int gen = Interlocked.Increment(ref connectionGen);
                    await ws.ConnectAsync(uri, ct);
                    socket = ws;
                    reconnectDelayMs = 1000;
                    // Un serveur qui ne prouve rien en 10 s n'est pas le desk : on coupe.
                    authWatchdog = Task.Delay(10000).ContinueWith(_ => { if (Volatile.Read(ref connectionGen) == gen && !deskVerified) AbortSocket(ws); });
                    await ReceiveLoop(ws, ct, gen);
                    if (!deskVerified && !warnedUnverified)
                    {
                        warnedUnverified = true;
                        Log("CΛNTO Bridge : le serveur n'a pas prouvé qu'il est le desk (desk à mettre à jour, ou autre programme sur le port) — rien n'a été envoyé.", LogLevel.Warning);
                    }
                }
                catch (Exception ex)
                {
                    if (!ct.IsCancellationRequested) Log("CΛNTO Bridge : WebSocket — " + ex.Message, LogLevel.Warning);
                }
                finally
                {
                    if (heartbeatTimer != null) heartbeatTimer.Dispose();
                    if (accountsTimer != null) accountsTimer.Dispose();
                    heartbeatTimer = null;
                    accountsTimer = null;
                    if (ReferenceEquals(socket, ws)) socket = null;
                    ws.Dispose();
                }
                if (ct.IsCancellationRequested) break;
                try { await Task.Delay(reconnectDelayMs, ct); } catch { break; }
                reconnectDelayMs = Math.Min(reconnectDelayMs * 2, 30000);
            }
        }

        private async Task ReceiveLoop(ClientWebSocket ws, CancellationToken ct, int gen)
        {
            byte[] buffer = new byte[8192];
            StringBuilder sb = new StringBuilder();
            while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
            {
                WebSocketReceiveResult result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
                if (result.MessageType == WebSocketMessageType.Close) break;
                sb.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
                if (!result.EndOfMessage) continue;
                string text = sb.ToString();
                sb.Clear();
                string copy = text;
                TriggerCustomEvent(delegate { DispatchDesk(copy, gen); }, null);
            }
        }

        private void AnswerChallenge(JObject p)
        {
            string nonce = (string)p["nonce"];
            if (!IsHex64(nonce))
            {
                AbortSocket(socket);
                return;
            }
            string mine = NewNonce();
            serverNonce = nonce;
            clientNonce = mine;
            SendNow(Notify("bridge.auth", new JObject { ["nonce"] = mine, ["proof"] = Proof("canto-addon|" + nonce + "|" + mine) }));
        }

        private void VerifyDesk(JObject p)
        {
            string proof = (string)p["proof"];
            if (clientNonce == null || serverNonce == null || !FixedTimeEquals(proof, Proof("canto-desk|" + clientNonce + "|" + serverNonce)))
            {
                Log("CΛNTO Bridge : preuve du desk invalide — connexion coupée, rien n'a été envoyé.", LogLevel.Warning);
                AbortSocket(socket);
                return;
            }
            deskVerified = true;
            warnedUnverified = false;
            StartSession();
        }

        private void StartSession()
        {
            if (heartbeatTimer != null) heartbeatTimer.Dispose();
            if (accountsTimer != null) accountsTimer.Dispose();
            SendHello();
            heartbeatTimer = new Timer(_ => Send(Notify("bridge.heartbeat", new JObject { ["at"] = NowMs() })), null, 2000, 2000);
            accountsTimer = new Timer(_ => SendAccounts(), null, 5000, 5000);
        }

        // HMAC-SHA256, clé = jeton en UTF-8, hexadécimal minuscule : la même preuve que le desk (authProof).
        private string Proof(string message)
        {
            using (HMACSHA256 hmac = new HMACSHA256(Encoding.UTF8.GetBytes(wsToken ?? "")))
                return ToHex(hmac.ComputeHash(Encoding.UTF8.GetBytes(message)));
        }

        private static string NewNonce()
        {
            byte[] bytes = new byte[32];
            using (RandomNumberGenerator rng = RandomNumberGenerator.Create())
                rng.GetBytes(bytes);
            return ToHex(bytes);
        }

        private static string ToHex(byte[] bytes)
        {
            StringBuilder sb = new StringBuilder(bytes.Length * 2);
            foreach (byte b in bytes) sb.Append(b.ToString("x2", CultureInfo.InvariantCulture));
            return sb.ToString();
        }

        private static bool IsHex64(string value)
        {
            if (value == null || value.Length != 64) return false;
            foreach (char c in value)
                if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
            return true;
        }

        private static bool FixedTimeEquals(string a, string b)
        {
            if (a == null || b == null || a.Length != b.Length) return false;
            int diff = 0;
            for (int i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
            return diff == 0;
        }

        private static void AbortSocket(ClientWebSocket ws)
        {
            if (ws == null) return;
            try { ws.Abort(); } catch { /* déjà fermé */ }
        }

        private void SendHello()
        {
            JArray accounts = new JArray();
            lock (Account.All)
            {
                foreach (Account account in Account.All)
                    if (account != null && !string.IsNullOrEmpty(account.Name)) accounts.Add(account.Name);
            }
            JObject hello = new JObject
            {
                ["kind"] = "ninjatrader",
                ["ntVersion"] = "8",
                ["addonVersion"] = "2.2.0",
                ["accounts"] = accounts,
                ["protocol"] = 1
            };
            Send(Notify("bridge.hello", hello));
            SendAccounts();
        }

        private void SendAccounts()
        {
            JArray rows = new JArray();
            lock (Account.All)
            {
                foreach (Account account in Account.All)
                {
                    if (account == null) continue;
                    JArray positions = new JArray();
                    try
                    {
                        foreach (Position position in account.Positions)
                        {
                            positions.Add(new JObject
                            {
                                ["instrument"] = position.Instrument != null ? position.Instrument.FullName : "",
                                ["quantity"] = position.MarketPosition == MarketPosition.Short ? -position.Quantity : position.Quantity,
                                ["avgPrice"] = position.AveragePrice
                            });
                        }
                    }
                    catch { /* positions indisponibles */ }
                    rows.Add(new JObject
                    {
                        ["name"] = account.Name,
                        ["cashValue"] = SafeItem(account, AccountItem.CashValue),
                        ["realizedPnl"] = SafeItem(account, AccountItem.RealizedProfitLoss),
                        ["unrealizedPnl"] = SafeItem(account, AccountItem.UnrealizedProfitLoss),
                        ["positions"] = positions
                    });
                }
            }
            Send(Notify("bridge.accounts", new JObject { ["accounts"] = rows }));
        }

        private static double SafeItem(Account account, AccountItem item)
        {
            try { return account.Get(item, Currency.UsDollar); }
            catch { return 0; }
        }

        private void SendExecution(Execution execution, MarketPosition marketPosition, int quantity, double price, DateTime time, string executionId)
        {
            if (execution == null || string.IsNullOrEmpty(executionId)) return;
            if (marketPosition != MarketPosition.Long && marketPosition != MarketPosition.Short) return;
            string action = marketPosition == MarketPosition.Long ? "Buy" : "Sell";
            JObject payload = new JObject
            {
                ["Instrument"] = execution.Instrument != null ? execution.Instrument.FullName : "",
                ["Action"] = action,
                ["Quantity"] = quantity,
                ["Price"] = price,
                ["Time"] = ToUnixMs(time),
                ["ID"] = executionId,
                ["E/X"] = execution.IsEntry ? "Entry" : (execution.IsExit ? "Exit" : ""),
                ["Position"] = "-",
                ["Order ID"] = execution.Order != null ? execution.Order.OrderId : "",
                ["Name"] = execution.Order != null ? execution.Order.Name : execution.Name,
                ["Commission"] = execution.Commission,
                ["Rate"] = execution.Rate,
                ["Account"] = execution.Account != null ? execution.Account.Name : "",
                ["Connection"] = ""
            };
            Send(Notify("bridge.execution", payload));
        }

        private void OnOrderUpdate(object sender, OrderEventArgs e)
        {
            try
            {
                Order order = e.Order;
                if (order == null) return;
                JObject payload = new JObject
                {
                    ["account"] = order.Account != null ? order.Account.Name : "",
                    ["orderId"] = order.OrderId,
                    ["instrument"] = order.Instrument != null ? order.Instrument.FullName : "",
                    ["action"] = order.OrderAction.ToString(),
                    ["type"] = order.OrderType.ToString(),
                    ["quantity"] = order.Quantity,
                    ["state"] = order.OrderState.ToString(),
                    ["tag"] = order.Name
                };
                if (order.LimitPrice > 0) payload["limitPrice"] = order.LimitPrice;
                if (order.StopPrice > 0) payload["stopPrice"] = order.StopPrice;
                Send(Notify("bridge.order", payload));
            }
            catch (Exception ex)
            {
                Log("CΛNTO Bridge : ordre — " + ex.Message, LogLevel.Warning);
            }
        }

        private void OnPositionUpdate(object sender, PositionEventArgs e)
        {
            SendAccounts();
        }

        private void OnAccountItemUpdate(object sender, AccountItemEventArgs e)
        {
            SendAccounts();
        }

        private void DispatchDesk(string json, int gen)
        {
            if (gen != Volatile.Read(ref connectionGen)) return;
            JObject msg;
            try { msg = JObject.Parse(json); }
            catch { return; }
            JToken id = msg["id"];
            string method = (string)msg["method"];
            if (string.IsNullOrEmpty(method)) return;
            JObject p = msg["params"] as JObject ?? new JObject();
            if (method == "bridge.challenge")
            {
                if (!deskVerified) AnswerChallenge(p);
                return;
            }
            if (method == "bridge.welcome")
            {
                if (!deskVerified) VerifyDesk(p);
                return;
            }
            // Avant la preuve du desk : aucun ordre, aucun abonnement, aucune réponse.
            if (!deskVerified) return;
            try
            {
                if (method == "marketdata.subscribe") Reply(id, SubscribeMarket(p));
                else if (method == "marketdata.unsubscribe") Reply(id, UnsubscribeMarket(p));
                else if (method == "marketdata.history") Reply(id, History(p));
                else if (method == "order.submit") Reply(id, SubmitOrder(p));
                else if (method == "order.cancel") Reply(id, CancelOrder(p));
                else if (method == "order.flatten") Reply(id, FlattenAccount(p));
                else if (method == "bridge.snapshot") Reply(id, new JObject());
                else if (method == "bridge.lost") { /* coupe-circuit côté desk */ }
            }
            catch (GuardException ex)
            {
                Log("CΛNTO Bridge : ordre refusé par l'AddOn — " + ex.Message, LogLevel.Warning);
                ReplyError(id, ex.Code, ex.Message);
            }
            catch (Exception ex)
            {
                ReplyError(id, -32000, ex.Message);
            }
        }

        private JObject SubscribeMarket(JObject p)
        {
            string instrumentName = (string)p["instrument"];
            string kind = (string)p["kind"];
            int timeframe = p["timeframe"] != null ? (int)p["timeframe"] : 1;
            Instrument instrument = Instrument.GetInstrument(instrumentName);
            if (instrument == null) throw new InvalidOperationException("instrument inconnu");
            string id = "s" + Interlocked.Increment(ref rpcSeq).ToString(CultureInfo.InvariantCulture);
            LiveSub sub = new LiveSub { Id = id, Kind = kind, Instrument = instrument, Timeframe = timeframe };
            if (kind == "bars")
            {
                BarsRequest req = new BarsRequest(instrument, DateTime.Now.AddMinutes(-timeframe), DateTime.Now);
                req.BarsPeriod = new BarsPeriod { BarsPeriodType = BarsPeriodType.Minute, Value = timeframe };
                sub.Bars = req;
                req.Update += (s, e) => OnLiveBar(sub, e);
                req.Request(new Action<BarsRequest, ErrorCode, string>((bars, errorCode, errorMessage) =>
                {
                    if (errorCode != ErrorCode.NoError) Log("CΛNTO Bridge : barres — " + errorMessage, LogLevel.Warning);
                }));
            }
            else
            {
                sub.OnMarketData = (s, e) => OnTickOrQuote(sub, e);
                instrument.MarketData.Update += sub.OnMarketData;
            }
            lock (liveSubs) liveSubs[id] = sub;
            return new JObject { ["subscriptionId"] = id };
        }

        private JObject UnsubscribeMarket(JObject p)
        {
            string id = (string)p["subscriptionId"];
            lock (liveSubs)
            {
                LiveSub sub;
                if (id != null && liveSubs.TryGetValue(id, out sub))
                {
                    Release(sub);
                    liveSubs.Remove(id);
                }
            }
            return new JObject { ["ok"] = true };
        }

        private JObject History(JObject p)
        {
            string instrumentName = (string)p["instrument"];
            int timeframe = p["timeframe"] != null ? (int)p["timeframe"] : 1;
            long from = p["from"] != null ? (long)p["from"] : 0;
            long to = p["to"] != null ? (long)p["to"] : NowSeconds();
            Instrument instrument = Instrument.GetInstrument(instrumentName);
            if (instrument == null) throw new InvalidOperationException("instrument inconnu");
            JArray bars = new JArray();
            BarsRequest req = new BarsRequest(instrument, FromUnixSeconds(from), FromUnixSeconds(to));
            req.BarsPeriod = new BarsPeriod { BarsPeriodType = BarsPeriodType.Minute, Value = timeframe };
            ManualResetEvent done = new ManualResetEvent(false);
            req.Request(new Action<BarsRequest, ErrorCode, string>((request, errorCode, errorMessage) =>
            {
                try
                {
                    if (errorCode == ErrorCode.NoError && request.Bars != null)
                    {
                        int count = Math.Min(request.Bars.Count, 50000);
                        int start = Math.Max(0, request.Bars.Count - count);
                        for (int i = start; i < request.Bars.Count; i++)
                        {
                            bars.Add(new JObject
                            {
                                ["time"] = ToUnixSeconds(request.Bars.GetTime(i)),
                                ["open"] = request.Bars.GetOpen(i),
                                ["high"] = request.Bars.GetHigh(i),
                                ["low"] = request.Bars.GetLow(i),
                                ["close"] = request.Bars.GetClose(i),
                                ["volume"] = request.Bars.GetVolume(i)
                            });
                        }
                    }
                }
                finally { done.Set(); }
            }));
            done.WaitOne(15000);
            return new JObject { ["bars"] = bars };
        }

        private JObject SubmitOrder(JObject p)
        {
            long started = NowMs();
            // Politique du jour, relue à chaque ordre : un compte retiré ou un plafond baissé s'applique tout de suite.
            ReadBridgeConfig();
            string accountName = (string)p["account"];
            string tag = (string)p["tag"] ?? "";
            double requested = p["quantity"] != null ? (double)p["quantity"] : 0;
            GuardSubmit(accountName, requested, tag);
            Account account = FindAccount(accountName);
            if (account == null) throw new InvalidOperationException("compte introuvable");
            if (!IsConnected(account)) throw new InvalidOperationException("compte non connecté");
            Instrument instrument = Instrument.GetInstrument((string)p["instrument"]);
            if (instrument == null) throw new InvalidOperationException("instrument inconnu");
            OrderAction action = ParseAction((string)p["action"]);
            OrderType type = ParseType((string)p["type"]);
            int quantity = (int)requested;
            double limit = p["limitPrice"] != null ? (double)p["limitPrice"] : 0;
            double stop = p["stopPrice"] != null ? (double)p["stopPrice"] : 0;
            string oco = (string)p["oco"] ?? "";
            Order order = account.CreateOrder(instrument, action, type, OrderEntry.Manual, TimeInForce.Day, quantity, limit, stop, oco, tag, Core.Globals.MaxDate, null, tag);
            order.Name = tag;
            account.Submit(new[] { order });
            return new JObject { ["orderId"] = order.OrderId ?? "", ["latencyMs"] = NowMs() - started };
        }

        // Garde propre de l'AddOn, mêmes codes que le desk : -32013 tag, -32010 compte, -32012 plafond.
        // Le desk garde ses règles ; un ordre ne part d'ici que s'il respecte aussi celles de bridge.json.
        private void GuardSubmit(string accountName, double quantity, string tag)
        {
            if (string.IsNullOrEmpty(tag) || tag.Trim().Length == 0) throw new GuardException(-32013, "tag obligatoire");
            bool allowed;
            int cap;
            lock (policyLock)
            {
                allowed = !string.IsNullOrEmpty(accountName) && (accountName.StartsWith("Sim", StringComparison.Ordinal) || extraAccounts.Contains(accountName));
                cap = maxContracts;
            }
            if (!allowed) throw new GuardException(-32010, "compte non autorisé par l'AddOn : " + accountName);
            if (quantity != Math.Floor(quantity) || quantity < 1 || quantity > cap)
                throw new GuardException(-32012, "plafond de l'AddOn : " + cap.ToString(CultureInfo.InvariantCulture) + " contrats");
        }

        private sealed class GuardException : Exception
        {
            public readonly int Code;

            public GuardException(int code, string message) : base(message)
            {
                Code = code;
            }
        }

        private JObject CancelOrder(JObject p)
        {
            Account account = FindAccount((string)p["account"]);
            if (account == null || !IsConnected(account)) throw new InvalidOperationException("compte non connecté");
            string orderId = (string)p["orderId"];
            lock (account.Orders)
            {
                foreach (Order order in account.Orders)
                {
                    if (order.OrderId == orderId)
                    {
                        account.Cancel(new[] { order });
                        return new JObject { ["ok"] = true };
                    }
                }
            }
            return new JObject { ["ok"] = false };
        }

        // Aplatit un compte : positions ouvertes ET ordres encore vivants. Account.Flatten annule les
        // ordres et clôt les positions des instruments donnés ; un instrument à plat qui porte un ordre
        // en attente (limite, stop) doit donc être dans la liste, sinon l'ordre survit au kill switch.
        private JObject FlattenAccount(JObject p)
        {
            Account account = FindAccount((string)p["account"]);
            if (account == null || !IsConnected(account)) throw new InvalidOperationException("compte non connecté");
            List<Instrument> instruments = new List<Instrument>();
            int positions = 0;
            lock (account.Positions)
            {
                foreach (Position position in account.Positions)
                {
                    if (position.Instrument == null) continue;
                    positions++;
                    if (!instruments.Contains(position.Instrument)) instruments.Add(position.Instrument);
                }
            }
            int working = 0;
            lock (account.Orders)
            {
                foreach (Order order in account.Orders)
                {
                    if (order.Instrument == null || IsTerminal(order.OrderState)) continue;
                    working++;
                    if (!instruments.Contains(order.Instrument)) instruments.Add(order.Instrument);
                }
            }
            if (instruments.Count > 0) account.Flatten(instruments);
            return new JObject { ["closed"] = positions, ["cancelled"] = working };
        }

        private static bool IsTerminal(OrderState state)
        {
            return state == OrderState.Filled || state == OrderState.Cancelled || state == OrderState.Rejected;
        }

        private static Account FindAccount(string name)
        {
            if (string.IsNullOrEmpty(name)) return null;
            lock (Account.All)
            {
                foreach (Account account in Account.All)
                    if (account != null && account.Name == name) return account;
            }
            return null;
        }

        private static bool IsConnected(Account account)
        {
            try { return account.Connection != null && account.Connection.Status == ConnectionStatus.Connected; }
            catch { return false; }
        }

        private static OrderAction ParseAction(string action)
        {
            if (action == "Sell") return OrderAction.Sell;
            if (action == "BuyToCover") return OrderAction.BuyToCover;
            if (action == "SellShort") return OrderAction.SellShort;
            return OrderAction.Buy;
        }

        private static OrderType ParseType(string type)
        {
            if (type == "Limit") return OrderType.Limit;
            if (type == "StopMarket") return OrderType.StopMarket;
            if (type == "StopLimit") return OrderType.StopLimit;
            return OrderType.Market;
        }

        private void OnLiveBar(LiveSub sub, BarsUpdateEventArgs e)
        {
            if (e == null || e.BarsSeries == null || e.BarsSeries.Count < 1) return;
            int i = e.BarsSeries.Count - 1;
            bool final = sub.LastBarTime != 0 && e.BarsSeries.GetTime(i).Ticks != sub.LastBarTime;
            int index = final ? Math.Max(0, i - 1) : i;
            sub.LastBarTime = e.BarsSeries.GetTime(i).Ticks;
            JObject bar = new JObject
            {
                ["time"] = ToUnixSeconds(e.BarsSeries.GetTime(index)),
                ["open"] = e.BarsSeries.GetOpen(index),
                ["high"] = e.BarsSeries.GetHigh(index),
                ["low"] = e.BarsSeries.GetLow(index),
                ["close"] = e.BarsSeries.GetClose(index),
                ["volume"] = e.BarsSeries.GetVolume(index)
            };
            Send(Notify("marketdata.bar", new JObject
            {
                ["instrument"] = sub.Instrument.FullName,
                ["timeframe"] = sub.Timeframe,
                ["bar"] = bar,
                ["final"] = final
            }));
        }

        private void OnTickOrQuote(LiveSub sub, MarketDataEventArgs e)
        {
            if (e == null) return;
            long now = NowMs();
            if (sub.Kind == "tick" && e.MarketDataType == MarketDataType.Last)
            {
                Send(Notify("marketdata.tick", new JObject
                {
                    ["instrument"] = sub.Instrument.FullName,
                    ["time"] = now,
                    ["price"] = e.Price,
                    ["size"] = e.Volume
                }));
            }
            if (sub.Kind == "quote" && (e.MarketDataType == MarketDataType.Bid || e.MarketDataType == MarketDataType.Ask || e.MarketDataType == MarketDataType.Last))
            {
                if (e.MarketDataType == MarketDataType.Bid) sub.Bid = e.Price;
                if (e.MarketDataType == MarketDataType.Ask) sub.Ask = e.Price;
                if (e.MarketDataType == MarketDataType.Last) sub.Last = e.Price;
                JObject quote = new JObject { ["instrument"] = sub.Instrument.FullName, ["time"] = now, ["bid"] = sub.Bid, ["ask"] = sub.Ask };
                if (sub.Last > 0) quote["last"] = sub.Last;
                Send(Notify("marketdata.quote", quote));
            }
        }

        private static void Release(LiveSub sub)
        {
            try
            {
                if (sub.Bars != null) sub.Bars.Dispose();
                if (sub.OnMarketData != null && sub.Instrument != null) sub.Instrument.MarketData.Update -= sub.OnMarketData;
            }
            catch { /* déjà libéré */ }
        }

        private void Reply(JToken id, JObject result)
        {
            if (id == null) return;
            JObject msg = new JObject { ["jsonrpc"] = "2.0", ["id"] = id, ["result"] = result };
            Send(msg);
        }

        private void ReplyError(JToken id, int code, string message)
        {
            if (id == null) return;
            JObject msg = new JObject { ["jsonrpc"] = "2.0", ["id"] = id, ["error"] = new JObject { ["code"] = code, ["message"] = message } };
            Send(msg);
        }

        private static JObject Notify(string method, JObject payload)
        {
            return new JObject { ["jsonrpc"] = "2.0", ["method"] = method, ["params"] = payload };
        }

        // Rien ne part (exécutions, comptes, réponses) tant que le serveur n'a pas prouvé qu'il est le desk.
        private void Send(JObject msg)
        {
            if (!deskVerified) return;
            SendNow(msg);
        }

        private void SendNow(JObject msg)
        {
            ClientWebSocket ws = socket;
            if (ws == null || ws.State != WebSocketState.Open) return;
            byte[] bytes = Encoding.UTF8.GetBytes(msg.ToString(Newtonsoft.Json.Formatting.None));
            lock (sendLock)
            {
                try { ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None).Wait(2000); }
                catch { /* reconnexion */ }
            }
        }

        private static long NowMs()
        {
            return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
        }

        private static long NowSeconds()
        {
            return NowMs() / 1000;
        }

        private static long ToUnixMs(DateTime time)
        {
            DateTime utc = time.Kind == DateTimeKind.Utc ? time : time.ToUniversalTime();
            return (long)(utc - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
        }

        private static long ToUnixSeconds(DateTime time)
        {
            return ToUnixMs(time) / 1000;
        }

        private static DateTime FromUnixSeconds(long seconds)
        {
            return new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddSeconds(seconds).ToLocalTime();
        }

        private sealed class LiveSub
        {
            public string Id;
            public string Kind;
            public Instrument Instrument;
            public int Timeframe;
            public BarsRequest Bars;
            public long LastBarTime;
            public double Bid;
            public double Ask;
            public double Last;
            public EventHandler<MarketDataEventArgs> OnMarketData;
        }

        private static string Csv(string value)
        {
            if (string.IsNullOrEmpty(value)) return "";
            char lead = value[0];
            if (lead == '=' || lead == '+' || lead == '-' || lead == '@')
                value = "'" + value;
            if (value.IndexOfAny(new[] { ',', '"', '\n', '\r' }) >= 0)
                return "\"" + value.Replace("\"", "\"\"") + "\"";
            return value;
        }
    }
}
