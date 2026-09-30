import { toast as sonnerToast } from 'sonner';

type Message = Parameters<typeof sonnerToast.error>[0];
type Options = Parameters<typeof sonnerToast.error>[1];

/**
 * App-wide toast wrapper.
 *
 * Confirmations ride the Toaster's 1.5s default so they stay out of the way.
 * Errors persist until dismissed: a failure that disappears before it is read
 * is indistinguishable from no failure at all, which is exactly how the
 * Mechanic Schedule bug stayed hidden.
 *
 * Import this instead of `sonner` directly so the policy holds everywhere.
 */
export const toast = {
  success: (message: Message, options?: Options) => sonnerToast.success(message, options),
  info: (message: Message, options?: Options) => sonnerToast.info(message, options),
  warning: (message: Message, options?: Options) => sonnerToast.warning(message, options),
  error: (message: Message, options?: Options) => sonnerToast.error(message, { duration: Infinity, ...options }),
  dismiss: (id?: string | number) => sonnerToast.dismiss(id),
};
