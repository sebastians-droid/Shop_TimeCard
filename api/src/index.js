// Azure Static Web Apps managed functions support HTTP triggers only, and reject a function
// app that registers any non-HTTP trigger. `./functions/employee-sync` defines a timer trigger,
// so it is deliberately NOT required here -- it cannot run under the current deployment.
// Moving the sync to its own Function App is tracked in docs/employee-sync-separation.md.
require('./functions/api');
