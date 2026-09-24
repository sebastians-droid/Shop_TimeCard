const { app } = require('@azure/functions');
const { runSync } = require('../../shared/employee-sync');

app.timer('employeeSync', {
  schedule: '0 0 5,13 * * *',
  handler: async (_timer, context) => {
    context.log('Employee sync timer triggered');
    try {
      const result = await runSync();
      context.log(`Sync result: ${result.created} created, ${result.updated} updated, ${result.deactivated} inactive, ${result.unchanged} unchanged`);
    } catch (error) {
      context.error('Employee sync failed:', error.message || error);
    }
  },
});
