const fs = require('fs');

let trCode = fs.readFileSync('src/repositories/__tests__/tenant.repository.test.ts', 'utf8');
trCode = trCode.replace(/subject: 'Ticket A', status: 'open', priority: 'normal', source: 'web' \}/g, "subject: 'Ticket A', status: 'open', priority: 'normal', source: 'web', customer_email: 'a@test.com' }");
trCode = trCode.replace(/subject: 'Ticket A', status: 'open', priority: 'normal', source: 'web', assigned_to: userB.id \}/g, "subject: 'Ticket A', status: 'open', priority: 'normal', source: 'web', assigned_to: userB.id, customer_email: 'a@test.com' }");
trCode = trCode.replace(/subject: 'Ticket A', status: 'open', priority: 'normal', source: 'web', customer_email: 'a@test.com', customer_email: 'a@test.com' /g, "subject: 'Ticket A', status: 'open', priority: 'normal', source: 'web', customer_email: 'a@test.com'");
fs.writeFileSync('src/repositories/__tests__/tenant.repository.test.ts', trCode);

// I will just use sed to do the trick for tenant repository tests if regex fails
