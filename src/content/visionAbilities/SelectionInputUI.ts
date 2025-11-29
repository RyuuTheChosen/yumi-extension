/**
 * Floating input UI for vision queries
 * Shows up when text is selected, allows custom instructions
 */

interface SelectionInputOptions {
  selectedText: string
  onSubmit: (instruction: string) => void
  onCancel: () => void
  position: { top: number; left: number }
}

export class SelectionInputUI {
  private container: HTMLDivElement | null = null
  private input: HTMLInputElement | null = null
  private selectedText: string = ''
  private onSubmit: ((instruction: string) => void) | null = null

  show(options: SelectionInputOptions) {
    this.hide() // Remove any existing UI

    this.selectedText = options.selectedText
    this.onSubmit = options.onSubmit

    // Create container - compact, above selection
    this.container = document.createElement('div')
    this.container.id = 'yumi-selection-input'

    // Position above the selection with proper spacing
    const uiHeight = 60
    const top = Math.max(15, options.position.top - uiHeight + window.scrollY)
    const left = Math.max(15, Math.min(window.innerWidth - 335, options.position.left + window.scrollX))

    Object.assign(this.container.style, {
      position: 'absolute',
      top: `${top}px`,
      left: `${left}px`,
      width: '320px',
      background: 'rgba(20, 20, 20, 0.90)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      borderRadius: '12px',
      padding: '10px 12px',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
      border: '1px solid rgba(255, 255, 255, 0.15)',
      zIndex: '2147483647',
      animation: 'yumiVisionFadeIn 0.2s ease-out',
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    })

    // Add ARIA attributes for accessibility
    this.container.setAttribute('role', 'dialog')
    this.container.setAttribute('aria-label', 'Ask Yumi about selected text')

    // Input field
    this.input = document.createElement('input')
    this.input.type = 'text'
    this.input.placeholder = 'Ask Yumi about this...'
    this.input.setAttribute('aria-label', 'Enter your question about the selected text')
    this.input.setAttribute('autocomplete', 'off')
    this.input.setAttribute('spellcheck', 'false')
    Object.assign(this.input.style, {
      flex: '1',
      padding: '8px 12px',
      fontSize: '13px',
      border: '1px solid rgba(255, 255, 255, 0.20)',
      borderRadius: '8px',
      background: 'rgba(255, 255, 255, 0.10)',
      color: 'rgba(255, 255, 255, 0.9)',
      outline: 'none',
      boxSizing: 'border-box',
      transition: 'border-color 0.15s, box-shadow 0.15s, background 0.15s',
    })
    this.input.onfocus = () => {
      if (this.input) {
        this.input.style.borderColor = 'rgba(255, 255, 255, 0.40)'
        this.input.style.boxShadow = '0 0 0 2px rgba(255, 255, 255, 0.1)'
        this.input.style.background = 'rgba(255, 255, 255, 0.15)'
      }
    }
    this.input.onblur = () => {
      if (this.input) {
        this.input.style.borderColor = 'rgba(255, 255, 255, 0.20)'
        this.input.style.boxShadow = 'none'
        this.input.style.background = 'rgba(255, 255, 255, 0.10)'
      }
    }
    this.input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        this.handleSubmit()
      } else if (e.key === 'Escape') {
        options.onCancel()
        this.hide()
      }
    }

    // Send button
    const sendBtn = document.createElement('button')
    sendBtn.textContent = '→'
    sendBtn.setAttribute('aria-label', 'Send question to Yumi')
    sendBtn.setAttribute('type', 'button')
    Object.assign(sendBtn.style, {
      padding: '8px 14px',
      fontSize: '14px',
      fontWeight: '600',
      border: 'none',
      borderRadius: '8px',
      background: 'rgba(255, 255, 255, 0.90)',
      color: '#1a1a1a',
      cursor: 'pointer',
      transition: 'background 0.15s',
      flexShrink: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      outline: 'none',
    })
    sendBtn.onmouseover = () => {
      sendBtn.style.background = 'rgba(255, 255, 255, 1)'
    }
    sendBtn.onmouseout = () => {
      sendBtn.style.background = 'rgba(255, 255, 255, 0.90)'
    }
    sendBtn.onmousedown = () => {
      sendBtn.style.transform = 'scale(0.95)'
    }
    sendBtn.onmouseup = () => {
      sendBtn.style.transform = 'scale(1)'
    }
    sendBtn.onclick = () => this.handleSubmit()

    // Assemble
    this.container.appendChild(this.input)
    this.container.appendChild(sendBtn)

    document.body.appendChild(this.container)

    // Focus input
    setTimeout(() => this.input?.focus(), 100)

    // Click outside to close
    const handleClickOutside = (e: MouseEvent) => {
      if (this.container && !this.container.contains(e.target as Node)) {
        options.onCancel()
        this.hide()
        document.removeEventListener('click', handleClickOutside)
      }
    }
    setTimeout(() => {
      document.addEventListener('click', handleClickOutside)
    }, 100)
  }

  private handleSubmit() {
    const instruction = this.input?.value.trim() || 'explain this'
    if (this.onSubmit) {
      this.onSubmit(instruction)
    }
    this.hide()
  }

  hide() {
    if (this.container) {
      this.container.style.animation = 'yumiVisionFadeOut 0.15s ease-out'
      setTimeout(() => {
        this.container?.remove()
        this.container = null
        this.input = null
      }, 150)
    }
  }

  isVisible(): boolean {
    return this.container !== null
  }
}

// Singleton instance
let selectionInputUI: SelectionInputUI | null = null

export function getSelectionInputUI(): SelectionInputUI {
  if (!selectionInputUI) {
    selectionInputUI = new SelectionInputUI()
  }
  return selectionInputUI
}
