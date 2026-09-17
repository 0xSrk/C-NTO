#region Using declarations
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using NinjaTrader.Cbi;
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
        private string folder;

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
                Log("CΛNTO Bridge actif → " + folder, LogLevel.Information);
            }
            else if (State == State.Terminated)
            {
                Account.AccountStatusUpdate -= OnAccountStatusUpdate;
                lock (subscribed)
                {
                    foreach (Account account in subscribed)
                        account.ExecutionUpdate -= OnExecutionUpdate;
                    subscribed.Clear();
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
                    File.Move(tmp, file, overwrite: true);

                    List<string> seenLines = new List<string>();
                    if (File.Exists(seen)) seenLines.AddRange(File.ReadAllLines(seen));
                    seenLines.Add(executionId);
                    File.WriteAllLines(seenTmp, seenLines, new UTF8Encoding(false));
                    File.Move(seenTmp, seen, overwrite: true);
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

        private static string Csv(string value)
        {
            if (string.IsNullOrEmpty(value)) return "";
            if (value.IndexOfAny(new[] { ',', '"', '\n', '\r' }) >= 0)
                return "\"" + value.Replace("\"", "\"\"") + "\"";
            return value;
        }
    }
}
