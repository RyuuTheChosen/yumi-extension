// Simple Web Speech STT wrapper for MVP
// Uses the browser's (webkit) SpeechRecognition API when available.

export type STTCallbacks = {
  onStart?: () => void
  onPartial?: (text: string) => void
  onFinal?: (text: string) => void
  onEnd?: () => void
  onError?: (err: any) => void
}

export type STTOptions = {
  lang?: string // e.g., 'en-US'
  interimResults?: boolean // default true
  continuous?: boolean // default true
}

declare global {
  // Some browsers expose only webkitSpeechRecognition
  // eslint-disable-next-line no-var
  var webkitSpeechRecognition: any
}

function getRecognitionCtor(): any | null {
  const w = (typeof window !== 'undefined') ? (window as any) : {}
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

export function isSttSupported(): boolean {
  return !!getRecognitionCtor()
}

export class WebSpeechSTT {
  private recognition: any | null = null
  private active = false
  private opts: Required<STTOptions>
  private cbs: STTCallbacks

  constructor(opts: STTOptions = {}, cbs: STTCallbacks = {}) {
    this.opts = {
      lang: opts.lang || 'en-US',
      interimResults: opts.interimResults ?? true,
      continuous: opts.continuous ?? true,
    }
    this.cbs = cbs
  }

  start() {
    const Ctor = getRecognitionCtor()
    if (!Ctor) {
      this.cbs.onError?.(new Error('SpeechRecognition not supported'))
      return
    }
    // Stop any existing instance first
    this.stop()
    const r = new Ctor()
    r.lang = this.opts.lang
    r.interimResults = this.opts.interimResults
    r.continuous = this.opts.continuous

    r.onstart = () => {
      this.active = true
      this.cbs.onStart?.()
    }
    r.onresult = (event: any) => {
      // Aggregate latest alternative
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i]
        const text = res[0]?.transcript ?? ''
        if (!text) continue
        if (res.isFinal) this.cbs.onFinal?.(text)
        else this.cbs.onPartial?.(text)
      }
    }
    r.onerror = (e: any) => {
      this.cbs.onError?.(e)
    }
    r.onend = () => {
      this.active = false
      this.cbs.onEnd?.()
    }

    this.recognition = r
    try {
      r.start()
    } catch (e) {
      this.cbs.onError?.(e)
    }
  }

  stop() {
    try {
      this.recognition?.stop?.()
      this.recognition = null
    } catch {}
    this.active = false
  }

  isActive() {
    return this.active
  }
}
