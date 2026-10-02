import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function EmployeeAccessGate({ email }: { email: string }) {
  return (
    <Card className="bg-card text-card-foreground shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl">Shop employee record not linked</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>
          Signed in as <span className="font-medium text-foreground">{email}</span>, but no Shop Employee row matches that
          Microsoft 365 address.
        </p>
        <p>
          Ask a manager to add your work Microsoft 365 email to the <strong className="text-foreground">Email</strong> field on
          your Employee record in Dataverse, then refresh this page.
        </p>
      </CardContent>
    </Card>
  );
}
