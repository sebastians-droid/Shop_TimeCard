import { useMemo } from 'react';
import { format } from 'date-fns';
import { CalendarIcon, Check, X } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useUpdateShopTimeEntry } from '@/hooks/use-shop-data';
import { getPtoHours, isPtoEntry } from '@/lib/time-rules';
import { ShopTimeEntryPTOApprovalKeyToLabel, ShopTimeEntryPTOTypeKeyToLabel, type ShopTimeEntry, type ShopTimeEntryPTOApprovalKey } from '@/models/shop-time-entry';
import type { AppShopEmployee } from '@/lib/shop-employees';
import { getEntryEmployeeName } from '@/lib/entry-helpers';

type PtoApprovalPanelProps = {
  timeEntries: ShopTimeEntry[];
  employees: AppShopEmployee[];
};

export function PtoApprovalPanel({ timeEntries, employees }: PtoApprovalPanelProps) {
  const updateTimeEntry = useUpdateShopTimeEntry();

  const pendingPtoRequests = useMemo(() => {
    return timeEntries
      .filter((entry: ShopTimeEntry) => isPtoEntry(entry) && entry.ptoApproval === 'Pending')
      .map((entry: ShopTimeEntry) => ({
        ...entry,
        employeeName: getEntryEmployeeName(entry, employees),
        dateLabel: entry.clockIn ? format(new Date(entry.clockIn), 'EEE, MMM d') : 'Unknown date',
        ptoHours: getPtoHours(entry),
        ptoType: entry.pTOTypeKey ? ShopTimeEntryPTOTypeKeyToLabel[entry.pTOTypeKey] : 'PTO',
      }))
      .sort((a, b) => new Date(a.clockIn ?? '').getTime() - new Date(b.clockIn ?? '').getTime());
  }, [timeEntries, employees]);

  const handlePtoApproval = async (entryId: string, approval: ShopTimeEntryPTOApprovalKey) => {
    try {
      await updateTimeEntry.mutateAsync({
        id: entryId,
        changedFields: { ptoApproval: approval },
      });
      toast.success(`PTO request ${approval.toLowerCase()}.`);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Unable to update PTO approval.');
    }
  };

  if (pendingPtoRequests.length === 0) return null;

  return (
    <Card className="border-l-4 border-l-amber-400 bg-card text-card-foreground shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl text-amber-600 dark:text-amber-400">
          <CalendarIcon className="h-5 w-5" /> Pending PTO requests ({pendingPtoRequests.length})
        </CardTitle>
        <p className="text-sm text-muted-foreground">Review and approve or deny PTO requests from all employees.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {pendingPtoRequests.map((pto) => (
          <div key={pto.id} className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/20 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-foreground">{pto.employeeName}</p>
              <p className="text-sm text-muted-foreground">{pto.dateLabel} · {pto.ptoHours} hours · {pto.ptoType}</p>
              <Badge variant="outline" className="mt-1 border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400">{ShopTimeEntryPTOApprovalKeyToLabel[pto.ptoApproval!]}</Badge>
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={() => void handlePtoApproval(pto.id, 'Approved')} disabled={updateTimeEntry.isPending}><Check className="mr-1 h-4 w-4" /> Approve</Button>
              <Button type="button" size="sm" variant="destructive" onClick={() => void handlePtoApproval(pto.id, 'Denied')} disabled={updateTimeEntry.isPending}><X className="mr-1 h-4 w-4" /> Deny</Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
