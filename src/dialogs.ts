import { shallowRef } from 'vue'

// One app-styled dialog instead of the browser's prompt/confirm/alert (rendered by components/AppDialog.vue).
export interface DialogRequest {
  title: string
  message?: string
  icon?: string
  // Text input (askText); its initial value.
  input?: string
  placeholder?: string
  confirmLabel?: string
  confirmIcon?: string
  // Hidden for notices that only need an OK.
  cancelLabel?: string | false
  danger?: boolean
  // Amber icon for warnings.
  warn?: boolean
  // A "Don't ask again" box; once ticked and confirmed, this localStorage key skips the dialog.
  remember?: string
  resolve: (value: string | boolean) => void
}

export const dialog = shallowRef<DialogRequest>()

function open(req: Omit<DialogRequest, 'resolve'>) {
  return new Promise<string | boolean>((resolve) => {
    dialog.value?.resolve(false)
    dialog.value = { ...req, resolve }
  })
}

export async function askConfirm(req: Omit<DialogRequest, 'resolve' | 'input'>): Promise<boolean> {
  try {
    if (req.remember && localStorage.getItem(req.remember) === '1') return true
  } catch {}
  return (await open(req)) !== false
}

export async function askText(req: Omit<DialogRequest, 'resolve' | 'remember'> & { input?: string }): Promise<string | undefined> {
  const v = await open({ input: '', ...req })
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

export async function notify(title: string, message?: string, icon = 'pi pi-info-circle'): Promise<void> {
  await open({ title, message, icon, confirmLabel: 'OK', cancelLabel: false })
}
