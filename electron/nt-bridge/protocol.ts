/**
 * Protocole JSON-RPC 2.0 du pont NinjaTrader (serveur dédié, pas l'orchestrateur).
 * Les temps : barres en epoch secondes UTC ; ticks, quotes et exécutions en epoch millisecondes.
 */

export const DEFAULT_PORT = 48231;
export const MAX_FRAME_BYTES = 256 * 1024;
export const HEARTBEAT_STALE_MS = 4_000;
export const HEARTBEAT_LOST_MS = 6_000;
export const HISTORY_BAR_CAP = 50_000;
export const PROTOCOL_VERSION = 1;

export const CLOSE = {
  NO_HELLO: 4400,
  BAD_TOKEN: 4401,
  REPLACED: 4409,
  TOO_BIG: 1009,
} as const;

/** Codes applicatifs. `-32013` : `order.submit` sans `tag` (traçabilité, non numéroté dans la spec). */
export const ERR = {
  PARSE: -32700,
  INVALID: -32600,
  METHOD: -32601,
  PARAMS: -32602,
  GENERIC: -32000,
  ACCOUNT: -32010,
  LOST: -32011,
  QUANTITY: -32012,
  TAG: -32013,
} as const;

export type RpcId = number | string;

export interface RpcErrorBody {
  code: number;
  message: string;
}

export type ParsedFrame =
  | { ok: true; kind: 'response'; id: RpcId; result?: unknown; error?: RpcErrorBody }
  | { ok: true; kind: 'call'; id?: RpcId; method: string; params: Record<string, unknown> }
  | { ok: false; id?: RpcId; code: number; message: string; close?: number };

export interface HelloParams {
  kind: 'ninjatrader';
  ntVersion: string;
  addonVersion: string;
  accounts: string[];
  protocol: 1;
}

export interface HeartbeatParams {
  at: number;
}

export interface AccountPosition {
  instrument: string;
  quantity: number;
  avgPrice: number;
}

export interface AccountSnapshot {
  name: string;
  cashValue: number;
  realizedPnl: number;
  unrealizedPnl: number;
  positions: AccountPosition[];
}

export interface ExecutionPayload {
  instrument: string;
  action: string;
  quantity: number;
  price: number;
  /** epoch millisecondes */
  time: number;
  id: string;
  entryExit: string;
  position: string;
  orderId: string;
  name: string;
  commission: number;
  rate: number;
  account: string;
  connection: string;
}

export interface OrderNotice {
  account: string;
  orderId: string;
  instrument: string;
  action: string;
  type: string;
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
  state: string;
  tag?: string;
}

export interface BarPayload {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketBarParams {
  instrument: string;
  timeframe: number;
  bar: BarPayload;
  final: boolean;
}

export interface MarketTickParams {
  instrument: string;
  time: number;
  price: number;
  size: number;
  side?: 'buy' | 'sell';
}

export interface MarketQuoteParams {
  instrument: string;
  time: number;
  bid: number;
  ask: number;
  last?: number;
}

export type OrderActionName = 'Buy' | 'Sell' | 'BuyToCover' | 'SellShort';
export type OrderTypeName = 'Market' | 'Limit' | 'StopMarket' | 'StopLimit';

export interface OrderSubmitParams {
  account: string;
  instrument: string;
  action: OrderActionName;
  quantity: number;
  type: OrderTypeName;
  limitPrice?: number;
  stopPrice?: number;
  oco?: string;
  tag: string;
}

export interface SubscribeParams {
  instrument: string;
  kind: 'bars' | 'tick' | 'quote';
  timeframe?: number;
}

const ACTIONS = new Set<OrderActionName>(['Buy', 'Sell', 'BuyToCover', 'SellShort']);
const TYPES = new Set<OrderTypeName>(['Market', 'Limit', 'StopMarket', 'StopLimit']);

export function frameExceedsCap(byteLength: number): boolean {
  return byteLength > MAX_FRAME_BYTES;
}

export function rpcResult(id: RpcId, result: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

export function rpcError(id: RpcId | undefined, code: number, message: string): string {
  const body: Record<string, unknown> = { jsonrpc: '2.0', error: { code, message } };
  if (id !== undefined) body.id = id;
  return JSON.stringify(body);
}

export function rpcNotify(method: string, params: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', method, params });
}

function isRpcId(v: unknown): v is RpcId {
  return typeof v === 'number' || typeof v === 'string';
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown, max = 256): string | null {
  return typeof v === 'string' && v.length <= max ? v : null;
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Analyse une trame UTF-8 déjà sous le plafond. */
export function parseFrame(raw: string): ParsedFrame {
  if (frameExceedsCap(Buffer.byteLength(raw, 'utf8'))) {
    return { ok: false, code: ERR.GENERIC, message: 'trame trop grande', close: CLOSE.TOO_BIG };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, code: ERR.PARSE, message: 'JSON invalide' };
  }
  const obj = asRecord(value);
  if (!obj || obj.jsonrpc !== '2.0') return { ok: false, code: ERR.INVALID, message: 'enveloppe JSON-RPC invalide' };
  const id = obj.id;
  if (id !== undefined && !isRpcId(id)) return { ok: false, code: ERR.INVALID, message: 'id invalide' };
  const hasResult = Object.prototype.hasOwnProperty.call(obj, 'result');
  const hasError = Object.prototype.hasOwnProperty.call(obj, 'error');
  if ((hasResult || hasError) && obj.method === undefined) {
    if (!isRpcId(id)) return { ok: false, code: ERR.INVALID, message: 'réponse sans id' };
    if (hasError) {
      const err = asRecord(obj.error);
      const code = err ? finite(err.code) : null;
      const message = err ? str(err.message, 500) : null;
      if (code === null || message === null) return { ok: false, id, code: ERR.INVALID, message: 'erreur JSON-RPC invalide' };
      return { ok: true, kind: 'response', id, error: { code, message } };
    }
    return { ok: true, kind: 'response', id, result: obj.result };
  }
  const method = str(obj.method, 64);
  if (!method) return { ok: false, id: isRpcId(id) ? id : undefined, code: ERR.INVALID, message: 'méthode absente' };
  const params = obj.params === undefined ? {} : asRecord(obj.params);
  if (!params) return { ok: false, id: isRpcId(id) ? id : undefined, code: ERR.PARAMS, message: 'params invalides' };
  return { ok: true, kind: 'call', id: isRpcId(id) ? id : undefined, method, params };
}

export type AddonCall =
  | { method: 'bridge.hello'; params: HelloParams }
  | { method: 'bridge.heartbeat'; params: HeartbeatParams }
  | { method: 'bridge.accounts'; params: { accounts: AccountSnapshot[] } }
  | { method: 'bridge.execution'; params: ExecutionPayload }
  | { method: 'bridge.order'; params: OrderNotice }
  | { method: 'marketdata.bar'; params: MarketBarParams }
  | { method: 'marketdata.tick'; params: MarketTickParams }
  | { method: 'marketdata.quote'; params: MarketQuoteParams };

export function validateAddonCall(method: string, params: Record<string, unknown>, helloSeen: boolean): { ok: true; call: AddonCall } | { ok: false; code: number; message: string; close?: number } {
  if (!helloSeen && method !== 'bridge.hello') {
    return { ok: false, code: ERR.GENERIC, message: 'bridge.hello requis', close: CLOSE.NO_HELLO };
  }
  switch (method) {
    case 'bridge.hello':
      return mapHello(params);
    case 'bridge.heartbeat':
      return mapHeartbeat(params);
    case 'bridge.accounts':
      return mapAccounts(params);
    case 'bridge.execution':
      return mapExecution(params);
    case 'bridge.order':
      return mapOrder(params);
    case 'marketdata.bar':
      return mapBar(params);
    case 'marketdata.tick':
      return mapTick(params);
    case 'marketdata.quote':
      return mapQuote(params);
    default:
      return { ok: false, code: ERR.METHOD, message: `méthode inconnue : ${method}` };
  }
}

function mapHello(p: Record<string, unknown>): { ok: true; call: AddonCall } | { ok: false; code: number; message: string; close?: number } {
  const kind = p.kind;
  const ntVersion = str(p.ntVersion, 64);
  const addonVersion = str(p.addonVersion, 64);
  const accounts = stringList(p.accounts);
  if (kind !== 'ninjatrader' || ntVersion === null || addonVersion === null || !accounts || p.protocol !== PROTOCOL_VERSION) {
    return { ok: false, code: ERR.PARAMS, message: 'bridge.hello invalide', close: CLOSE.NO_HELLO };
  }
  return { ok: true, call: { method: 'bridge.hello', params: { kind: 'ninjatrader', ntVersion, addonVersion, accounts, protocol: 1 } } };
}

function mapHeartbeat(p: Record<string, unknown>): { ok: true; call: AddonCall } | { ok: false; code: number; message: string } {
  const at = finite(p.at);
  if (at === null) return { ok: false, code: ERR.PARAMS, message: 'bridge.heartbeat invalide' };
  return { ok: true, call: { method: 'bridge.heartbeat', params: { at } } };
}

function mapAccounts(p: Record<string, unknown>): { ok: true; call: AddonCall } | { ok: false; code: number; message: string } {
  if (!Array.isArray(p.accounts)) return { ok: false, code: ERR.PARAMS, message: 'bridge.accounts invalide' };
  const accounts: AccountSnapshot[] = [];
  for (const raw of p.accounts) {
    const row = asRecord(raw);
    if (!row) return { ok: false, code: ERR.PARAMS, message: 'compte invalide' };
    const name = str(row.name, 128);
    const cashValue = finite(row.cashValue);
    const realizedPnl = finite(row.realizedPnl);
    const unrealizedPnl = finite(row.unrealizedPnl);
    if (!name || cashValue === null || realizedPnl === null || unrealizedPnl === null || !Array.isArray(row.positions)) {
      return { ok: false, code: ERR.PARAMS, message: 'compte invalide' };
    }
    const positions: AccountPosition[] = [];
    for (const pos of row.positions) {
      const pr = asRecord(pos);
      if (!pr) return { ok: false, code: ERR.PARAMS, message: 'position invalide' };
      const instrument = str(pr.instrument, 64);
      const quantity = finite(pr.quantity);
      const avgPrice = finite(pr.avgPrice);
      if (!instrument || quantity === null || avgPrice === null) return { ok: false, code: ERR.PARAMS, message: 'position invalide' };
      positions.push({ instrument, quantity, avgPrice });
    }
    accounts.push({ name, cashValue, realizedPnl, unrealizedPnl, positions });
  }
  return { ok: true, call: { method: 'bridge.accounts', params: { accounts } } };
}

function pick(p: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (p[key] !== undefined) return p[key];
  return undefined;
}

function mapExecution(p: Record<string, unknown>): { ok: true; call: AddonCall } | { ok: false; code: number; message: string } {
  const instrument = str(pick(p, ['Instrument', 'instrument']), 64);
  const action = str(pick(p, ['Action', 'action']), 32);
  const quantity = finite(pick(p, ['Quantity', 'quantity']));
  const price = finite(pick(p, ['Price', 'price']));
  const time = coerceTimeMs(pick(p, ['Time', 'time']));
  const id = str(pick(p, ['ID', 'id', 'executionId']), 128) ?? '';
  const account = str(pick(p, ['Account', 'account']), 128);
  if (!instrument || !action || quantity === null || !Number.isInteger(quantity) || quantity <= 0 || price === null || price < 0 || time === null || !account) {
    return { ok: false, code: ERR.PARAMS, message: 'bridge.execution invalide' };
  }
  const commission = finite(pick(p, ['Commission', 'commission'])) ?? 0;
  const rate = finite(pick(p, ['Rate', 'rate'])) ?? 0;
  const payload: ExecutionPayload = {
    instrument,
    action,
    quantity,
    price,
    time,
    id,
    entryExit: str(pick(p, ['E/X', 'entryExit']), 16) ?? '',
    position: str(pick(p, ['Position', 'position']), 32) ?? '',
    orderId: str(pick(p, ['Order ID', 'orderId']), 128) ?? '',
    name: str(pick(p, ['Name', 'name']), 128) ?? '',
    commission,
    rate,
    account,
    connection: str(pick(p, ['Connection', 'connection']), 64) ?? '',
  };
  return { ok: true, call: { method: 'bridge.execution', params: payload } };
}

function coerceTimeMs(v: unknown): number | null {
  const n = finite(v);
  if (n !== null) return n;
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

function mapOrder(p: Record<string, unknown>): { ok: true; call: AddonCall } | { ok: false; code: number; message: string } {
  const account = str(p.account, 128);
  const orderId = str(p.orderId, 128);
  const instrument = str(p.instrument, 64);
  const action = str(p.action, 32);
  const type = str(p.type, 32);
  const quantity = finite(p.quantity);
  const state = str(p.state, 32);
  if (!account || !orderId || !instrument || !action || !type || quantity === null || !state) {
    return { ok: false, code: ERR.PARAMS, message: 'bridge.order invalide' };
  }
  const notice: OrderNotice = { account, orderId, instrument, action, type, quantity, state };
  const limitPrice = finite(p.limitPrice);
  const stopPrice = finite(p.stopPrice);
  const tag = str(p.tag, 128);
  if (limitPrice !== null) notice.limitPrice = limitPrice;
  if (stopPrice !== null) notice.stopPrice = stopPrice;
  if (tag) notice.tag = tag;
  return { ok: true, call: { method: 'bridge.order', params: notice } };
}

function mapBar(p: Record<string, unknown>): { ok: true; call: AddonCall } | { ok: false; code: number; message: string } {
  const instrument = str(p.instrument, 64);
  const timeframe = finite(p.timeframe);
  const bar = asRecord(p.bar);
  if (!instrument || timeframe === null || !Number.isInteger(timeframe) || timeframe <= 0 || !bar || typeof p.final !== 'boolean') {
    return { ok: false, code: ERR.PARAMS, message: 'marketdata.bar invalide' };
  }
  const time = finite(bar.time);
  const open = finite(bar.open);
  const high = finite(bar.high);
  const low = finite(bar.low);
  const close = finite(bar.close);
  const volume = finite(bar.volume);
  if (time === null || open === null || high === null || low === null || close === null || volume === null) {
    return { ok: false, code: ERR.PARAMS, message: 'barre invalide' };
  }
  return { ok: true, call: { method: 'marketdata.bar', params: { instrument, timeframe, bar: { time, open, high, low, close, volume }, final: p.final } } };
}

function mapTick(p: Record<string, unknown>): { ok: true; call: AddonCall } | { ok: false; code: number; message: string } {
  const instrument = str(p.instrument, 64);
  const time = finite(p.time);
  const price = finite(p.price);
  const size = finite(p.size);
  if (!instrument || time === null || price === null || size === null) return { ok: false, code: ERR.PARAMS, message: 'marketdata.tick invalide' };
  const tick: MarketTickParams = { instrument, time, price, size };
  if (p.side === 'buy' || p.side === 'sell') tick.side = p.side;
  else if (p.side !== undefined) return { ok: false, code: ERR.PARAMS, message: 'marketdata.tick invalide' };
  return { ok: true, call: { method: 'marketdata.tick', params: tick } };
}

function mapQuote(p: Record<string, unknown>): { ok: true; call: AddonCall } | { ok: false; code: number; message: string } {
  const instrument = str(p.instrument, 64);
  const time = finite(p.time);
  const bid = finite(p.bid);
  const ask = finite(p.ask);
  if (!instrument || time === null || bid === null || ask === null) return { ok: false, code: ERR.PARAMS, message: 'marketdata.quote invalide' };
  const quote: MarketQuoteParams = { instrument, time, bid, ask };
  const last = finite(p.last);
  if (last !== null) quote.last = last;
  return { ok: true, call: { method: 'marketdata.quote', params: quote } };
}

function stringList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const item of v) {
    const s = str(item, 128);
    if (s === null || !s) return null;
    out.push(s);
  }
  return out;
}

export function validateOrderSubmit(p: Record<string, unknown>): { ok: true; order: OrderSubmitParams } | { ok: false; code: number; message: string } {
  const account = str(p.account, 128);
  const instrument = str(p.instrument, 64);
  const action = p.action;
  const type = p.type;
  const quantity = finite(p.quantity);
  const tag = typeof p.tag === 'string' ? p.tag.trim() : '';
  if (!tag) return { ok: false, code: ERR.TAG, message: 'tag obligatoire' };
  if (!account || !instrument || !ACTIONS.has(action as OrderActionName) || !TYPES.has(type as OrderTypeName) || quantity === null || !Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, code: ERR.PARAMS, message: 'order.submit invalide' };
  }
  const order: OrderSubmitParams = { account, instrument, action: action as OrderActionName, quantity, type: type as OrderTypeName, tag };
  const limitPrice = finite(p.limitPrice);
  const stopPrice = finite(p.stopPrice);
  const oco = str(p.oco, 64);
  if (limitPrice !== null) order.limitPrice = limitPrice;
  if (stopPrice !== null) order.stopPrice = stopPrice;
  if (oco) order.oco = oco;
  if ((type === 'Limit' || type === 'StopLimit') && limitPrice === null) return { ok: false, code: ERR.PARAMS, message: 'limitPrice requis' };
  if ((type === 'StopMarket' || type === 'StopLimit') && stopPrice === null) return { ok: false, code: ERR.PARAMS, message: 'stopPrice requis' };
  return { ok: true, order };
}

export function validateSubscribe(p: Record<string, unknown>): { ok: true; req: SubscribeParams } | { ok: false; code: number; message: string } {
  const instrument = str(p.instrument, 64);
  const kind = p.kind;
  if (!instrument || (kind !== 'bars' && kind !== 'tick' && kind !== 'quote')) return { ok: false, code: ERR.PARAMS, message: 'marketdata.subscribe invalide' };
  const req: SubscribeParams = { instrument, kind };
  if (kind === 'bars') {
    const timeframe = finite(p.timeframe);
    if (timeframe === null || !Number.isInteger(timeframe) || timeframe <= 0) return { ok: false, code: ERR.PARAMS, message: 'timeframe requis' };
    req.timeframe = timeframe;
  }
  return { ok: true, req };
}
