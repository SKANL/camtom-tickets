import type {
  ConfigResponse,
  DisplayV2Capabilities,
  Issue,
  ScreenDevice,
  ScreenState,
} from '@camtom/shared';
import { DISPLAY_SYNC_INTERVAL_MS, rowToIssue } from '@camtom/shared';
import { DisplayTransportError, type DisplayTransport } from './display-transport';

export type DisplayPhase =
  | 'initializing'
  | 'pairing'
  | 'connecting'
  | 'paired'
  | 'offline'
  | 'expired'
  | 'revoked'
  | 'incompatible'
  | 'error';

export interface DisplayPairingView {
  code: string;
  expiresAt: string;
}

export interface DisplaySnapshot {
  phase: DisplayPhase;
  pairing?: DisplayPairingView;
  config?: ConfigResponse;
  screenState?: ScreenState;
  issues: Issue[];
  device?: ScreenDevice;
  lastUpdated?: string;
  nextPollMs: number;
  consecutiveFailures: number;
  message?: string;
  capabilities: DisplayV2Capabilities;
}

export interface InstallationCredential {
  installationId: string;
  installationSecret: string;
}

export interface DisplayRuntimeEnvironment {
  hash(): string;
  setPermanentFragment(credential: InstallationCredential): void;
  clearFragment(): void;
  now(): number;
  random(): number;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(timer: number): void;
  addWakeListeners(callback: () => void): () => void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

export function parseInstallationFragment(hash: string): InstallationCredential | null {
  const prefix = '#installation=';
  if (hash.slice(0, prefix.length) !== prefix) return null;
  const value = hash.slice(prefix.length);
  const separator = value.indexOf('.');
  if (separator < 0 || value.indexOf('.', separator + 1) >= 0) return null;
  const installationId = value.slice(0, separator);
  const installationSecret = value.slice(separator + 1);
  return UUID.test(installationId) && SECRET.test(installationSecret)
    ? { installationId, installationSecret }
    : null;
}

export function permanentDisplayPath(credential: InstallationCredential): string {
  return `/display#installation=${credential.installationId}.${credential.installationSecret}`;
}

export function createLegacyRequestId(random: () => number = Math.random): string {
  let value = '';
  for (let index = 0; index < 32; index += 1) value += Math.floor(random() * 16).toString(16);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20)}`;
}

function storageAvailable(): boolean {
  try {
    const key = '__camtom_tv_probe__';
    window.localStorage.setItem(key, '1');
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function detectDisplayCapabilities(): DisplayV2Capabilities {
  const viewport = typeof window === 'undefined'
    ? undefined
    : { width: window.innerWidth || 0, height: window.innerHeight || 0 };
  return {
    userAgent: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
    viewport,
    cookies: typeof navigator !== 'undefined' ? navigator.cookieEnabled !== false : false,
    localStorage: typeof window !== 'undefined' && storageAvailable(),
    webSocket: typeof WebSocket !== 'undefined',
    fetch: typeof fetch !== 'undefined',
    xhr: typeof XMLHttpRequest !== 'undefined',
    cssCustomProperties: typeof CSS !== 'undefined'
      && typeof CSS.supports === 'function'
      && CSS.supports('--camtom-tv-color', '#fff'),
    protocolVersion: 2,
  };
}

function browserEnvironment(): DisplayRuntimeEnvironment {
  return {
    hash: () => window.location.hash,
    setPermanentFragment: (credential) => {
      const path = permanentDisplayPath(credential);
      try {
        if (window.history && typeof window.history.replaceState === 'function') {
          window.history.replaceState(null, '', path);
          return;
        }
      } catch { /* old embedded engines can expose but reject history.replaceState */ }
      // Hash assignment stays in the same document; it never sends the secret to the server.
      window.location.hash = path.slice(path.indexOf('#'));
    },
    clearFragment: () => {
      try {
        if (window.history && typeof window.history.replaceState === 'function') {
          window.history.replaceState(null, '', '/display');
          return;
        }
      } catch { /* fall through */ }
      window.location.hash = '';
    },
    now: () => Date.now(),
    random: () => Math.random(),
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: (timer) => window.clearTimeout(timer),
    addWakeListeners: (callback) => {
      let lastTick = Date.now();
      const onActivity = () => {
        lastTick = Date.now();
        if (document.visibilityState !== 'hidden') callback();
      };
      const probeWake = () => {
        const now = Date.now();
        if (now - lastTick > 20_000) callback();
        lastTick = now;
      };
      window.addEventListener('focus', onActivity);
      window.addEventListener('online', onActivity);
      document.addEventListener('visibilitychange', onActivity);
      const wakeProbe = window.setInterval(probeWake, 10_000);
      return () => {
        window.removeEventListener('focus', onActivity);
        window.removeEventListener('online', onActivity);
        document.removeEventListener('visibilitychange', onActivity);
        window.clearInterval(wakeProbe);
      };
    },
  };
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof DisplayTransportError && error.status === 401;
}

export class DisplayRuntime {
  private snapshot: DisplaySnapshot;
  private credential: InstallationCredential | null = null;
  private deviceToken: string | undefined;
  private pairing: { pairingId: string; expiresAt: string } | null = null;
  private appliedStateVersion = 0;
  private ticketVersion: string | null = null;
  private configVersion: string | null = null;
  private timer: number | null = null;
  private stopWakeListeners: (() => void) | null = null;
  private stopped = false;
  private syncing = false;
  private runId = 0;
  private listeners: Array<(snapshot: DisplaySnapshot) => void> = [];

  constructor(
    private readonly transport: DisplayTransport,
    private readonly env: DisplayRuntimeEnvironment = browserEnvironment(),
    capabilities: DisplayV2Capabilities = detectDisplayCapabilities(),
  ) {
    const xhrUnavailable = capabilities.xhr === false;
    const cssUnavailable = capabilities.cssCustomProperties === false;
    const incompatible = xhrUnavailable || cssUnavailable;
    this.snapshot = {
      phase: incompatible ? 'incompatible' : 'initializing',
      issues: [],
      nextPollMs: DISPLAY_SYNC_INTERVAL_MS,
      consecutiveFailures: 0,
      capabilities,
      ...(incompatible
        ? { message: xhrUnavailable
          ? 'Este navegador no ofrece XHR. No puede ejecutar la aplicación de pantalla.'
          : 'Este navegador no soporta variables CSS, necesarias para mostrar el tablero correctamente.' }
        : {}),
    };
  }

  current(): DisplaySnapshot { return this.snapshot; }

  subscribe(listener: (snapshot: DisplaySnapshot) => void): () => void {
    this.listeners.push(listener);
    listener(this.snapshot);
    return () => { this.listeners = this.listeners.filter((candidate) => candidate !== listener); };
  }

  start(): void {
    if (this.snapshot.phase === 'incompatible' || this.stopWakeListeners) return;
    this.stopped = false;
    const runId = ++this.runId;
    this.stopWakeListeners = this.env.addWakeListeners(() => this.syncNow());
    const parsed = parseInstallationFragment(this.env.hash());
    if (parsed) {
      this.credential = parsed;
      void this.openSession(runId);
    } else {
      void this.startPairing(runId);
    }
  }

  stop(): void {
    this.stopped = true;
    this.runId += 1;
    this.syncing = false;
    if (this.timer) this.env.clearTimeout(this.timer);
    this.timer = null;
    this.stopWakeListeners?.();
    this.stopWakeListeners = null;
  }

  restartPairing(): void {
    const runId = ++this.runId;
    this.stopped = false;
    this.syncing = false;
    if (this.timer) this.env.clearTimeout(this.timer);
    this.timer = null;
    this.pairing = null;
    this.credential = null;
    this.deviceToken = undefined;
    if (this.env.hash().slice(0, 14) === '#installation=') this.env.clearFragment();
    void this.startPairing(runId);
  }

  syncNow(): void {
    if (this.stopped || this.syncing || !this.deviceToken || this.isTerminal()) return;
    if (this.timer) this.env.clearTimeout(this.timer);
    this.timer = null;
    void this.sync(this.runId);
  }

  private active(runId: number): boolean { return !this.stopped && runId === this.runId; }

  private isTerminal(): boolean {
    return this.snapshot.phase === 'revoked' || this.snapshot.phase === 'expired' || this.snapshot.phase === 'incompatible';
  }

  private enterTerminal(phase: 'revoked' | 'expired', message: string): void {
    if (this.timer) this.env.clearTimeout(this.timer);
    this.timer = null;
    this.deviceToken = undefined;
    this.pairing = null;
    this.credential = null;
    this.emit({ phase, pairing: undefined, message });
  }

  private emit(update: Partial<DisplaySnapshot>): void {
    this.snapshot = { ...this.snapshot, ...update };
    for (let index = 0; index < this.listeners.length; index += 1) this.listeners[index](this.snapshot);
  }

  private schedule(callback: () => void, delay: number): void {
    if (this.stopped) return;
    if (this.timer) this.env.clearTimeout(this.timer);
    this.timer = this.env.setTimeout(callback, delay);
  }

  private async startPairing(runId: number): Promise<void> {
    if (!this.active(runId)) return;
    this.emit({ phase: 'connecting', pairing: undefined, message: undefined });
    try {
      const response = await this.transport.createPairing({
        requestId: createLegacyRequestId(this.env.random),
        capabilities: this.snapshot.capabilities,
      });
      if (!this.active(runId)) return;
      this.pairing = { pairingId: response.pairingId, expiresAt: response.expiresAt };
      this.credential = {
        installationId: response.installationId,
        installationSecret: response.installationSecret,
      };
      this.emit({
        phase: 'pairing',
        pairing: { code: response.code, expiresAt: response.expiresAt },
        message: undefined,
      });
      this.schedule(() => { void this.pollPairing(runId); }, 2_500);
    } catch (error) {
      if (!this.active(runId)) return;
      const status = error instanceof DisplayTransportError ? error.status : undefined;
      this.emit({
        phase: 'error',
        message: status === 429
          ? 'Se alcanzó el límite de vinculaciones. Esperá quince minutos.'
          : error instanceof Error ? error.message : 'No se pudo iniciar la vinculación.',
      });
    }
  }

  private async pollPairing(runId: number): Promise<void> {
    if (!this.pairing || !this.credential || !this.active(runId)) return;
    if (this.env.now() >= Date.parse(this.pairing.expiresAt)) {
      this.enterTerminal('expired', 'El código venció. Generá uno nuevo.');
      return;
    }
    try {
      const response = await this.transport.pairingStatus(
        this.pairing.pairingId,
        this.credential.installationSecret,
      );
      if (!this.active(runId)) return;
      if (response.status === 'pending') {
        this.schedule(() => { void this.pollPairing(runId); }, 2_500);
        return;
      }
      if (response.status === 'expired') {
        this.enterTerminal('expired', 'El código venció. Generá uno nuevo.');
        return;
      }
      if (response.status === 'revoked') {
        this.enterTerminal('revoked', 'Esta instalación fue revocada desde el control.');
        return;
      }
      if (!response.deviceToken) throw new Error('La vinculación no devolvió una sesión utilizable.');
      this.deviceToken = response.deviceToken;
      // Keep the permanent secret in the fragment and continue in this document.
      this.env.setPermanentFragment(this.credential);
      this.pairing = null;
      await this.openSession(runId);
    } catch (error) {
      if (!this.active(runId)) return;
      if (isUnauthorized(error)) {
        this.enterTerminal('revoked', 'La credencial de vinculación ya no es válida.');
        return;
      }
      this.emit({ phase: 'pairing', message: error instanceof Error ? error.message : 'Sin conexión.' });
      this.schedule(() => { void this.pollPairing(runId); }, 5_000);
    }
  }

  private async openSession(runId: number): Promise<void> {
    if (!this.credential || !this.active(runId)) return;
    this.emit({ phase: 'connecting', pairing: undefined, message: undefined });
    try {
      const response = await this.transport.createSession(
        { installationId: this.credential.installationId },
        this.credential.installationSecret,
      );
      if (!this.active(runId)) return;
      this.deviceToken = response.deviceToken;
      await this.sync(runId);
    } catch (error) {
      if (!this.active(runId)) return;
      if (isUnauthorized(error)) {
        this.enterTerminal('revoked', 'La URL permanente fue revocada o reemplazada.');
      } else {
        this.failAndRetry(error, runId, () => { void this.openSession(runId); });
      }
    }
  }

  private async sync(runId: number): Promise<void> {
    if (!this.deviceToken || this.syncing || !this.active(runId) || this.isTerminal()) return;
    this.syncing = true;
    try {
      const sentAppliedStateVersion = this.appliedStateVersion;
      const response = await this.transport.sync({
        appliedStateVersion: sentAppliedStateVersion,
        ticketVersion: this.ticketVersion,
        configVersion: this.configVersion,
        capabilities: this.snapshot.capabilities,
      }, this.deviceToken);
      if (!this.active(runId)) return;
      if (response.deviceToken) this.deviceToken = response.deviceToken;

      const update: Partial<DisplaySnapshot> = {
        phase: 'paired',
        device: response.device,
        lastUpdated: new Date(this.env.now()).toISOString(),
        nextPollMs: Math.max(5_000, Math.min(60_000, response.nextPollMs || DISPLAY_SYNC_INTERVAL_MS)),
        consecutiveFailures: 0,
        message: undefined,
        capabilities: { ...this.snapshot.capabilities, lastError: '', lastErrorAt: '' },
      };
      if (response.config) update.config = response.config;
      if (response.tickets) update.issues = response.tickets.map(rowToIssue);
      const appliedAdvancedState = Boolean(
        response.desiredState && response.device.stateVersion > sentAppliedStateVersion,
      );
      if (response.desiredState && appliedAdvancedState) {
        update.screenState = response.desiredState;
        this.appliedStateVersion = response.device.stateVersion;
      }
      this.ticketVersion = response.ticketVersion;
      this.configVersion = response.configVersion;
      this.emit(update);
      // Report a newly applied state immediately. The sent-version comparison prevents
      // repeated desiredState payloads from creating an ACK loop, while schedule()
      // keeps only one follow-up in flight.
      this.schedule(() => { void this.sync(runId); }, appliedAdvancedState ? 0 : update.nextPollMs as number);
    } catch (error) {
      if (!this.active(runId)) return;
      if (isUnauthorized(error) && this.credential) {
        this.deviceToken = undefined;
        this.schedule(() => { void this.openSession(runId); }, 250);
      } else {
        this.failAndRetry(error, runId, () => { void this.sync(runId); });
      }
    } finally {
      if (runId === this.runId) this.syncing = false;
    }
  }

  private failAndRetry(error: unknown, runId: number, retry: () => void): void {
    if (!this.active(runId)) return;
    const failures = this.snapshot.consecutiveFailures + 1;
    const base = Math.min(60_000, 2_000 * Math.pow(2, Math.min(failures - 1, 5)));
    const delay = Math.min(60_000, Math.round(base * (0.85 + this.env.random() * 0.3)));
    this.emit({
      phase: this.snapshot.screenState ? 'offline' : 'connecting',
      consecutiveFailures: failures,
      nextPollMs: delay,
      message: error instanceof Error ? error.message : 'No hay conexión con el servidor.',
      capabilities: {
        ...this.snapshot.capabilities,
        lastError: error instanceof Error ? error.message : 'No hay conexión con el servidor.',
        lastErrorAt: new Date(this.env.now()).toISOString(),
      },
    });
    this.schedule(retry, delay);
  }
}
