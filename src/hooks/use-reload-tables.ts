import { toast } from 'sonner';

type Refetch = () => Promise<unknown>;

/**
 * Reloads the cached reference tables behind a page.
 *
 * Both the kiosk timecard and the manager dashboard can sit open for a whole
 * shift, so each offers a manual reload rather than waiting for a refetch.
 */
export function useReloadTables(...refetchers: Refetch[]) {
  return async () => {
    try {
      await Promise.all(refetchers.map((refetch: Refetch) => refetch()));
      toast.success('Equipment assets and shop time entries reloaded.');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Unable to reload table data.');
    }
  };
}
