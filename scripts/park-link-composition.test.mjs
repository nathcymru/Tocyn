import assert from 'node:assert/strict';
import test from 'node:test';
import { parkLinkCompositionFailures } from './park-link-composition.mjs';

const dashboard = 'apps/dashboard/src/pages/Example.tsx';
const imports = `
  import { Link as RouterLink, NavLink } from 'react-router-dom';
  import { Link as ParkLink } from '@luminatick/ui/components';
  import { ParkButton, ParkMenu } from '@luminatick/ui/park';
`;

test('accepts only direct installed Park asChild compositions and official Link', () => {
  const jsx = `${imports}
    <><ParkLink asChild><RouterLink to="/inbox">Inbox</RouterLink></ParkLink>
    <ParkMenu.Item asChild><NavLink to="/settings">Settings</NavLink></ParkMenu.Item>
    <ParkButton asChild><a href="/reload">Reload</a></ParkButton>
    <ParkLink asChild><RouterLink to="/empty" /></ParkLink>
    <ParkButton asChild><a href="/download" /></ParkButton>
    <ParkLink href="/help">Help</ParkLink></>`;
  assert.deepEqual(parkLinkCompositionFailures(dashboard, jsx), []);
});

test('rejects multiple direct children under a single asChild wrapper', () => {
  const jsx = `${imports}<ParkLink asChild><RouterLink to="/one">One</RouterLink><RouterLink to="/two">Two</RouterLink></ParkLink>`;
  assert.equal(parkLinkCompositionFailures(dashboard, jsx).length, 2);
});

test('rejects aliases of imported Router links, including chained and namespaced aliases', () => {
  const jsx = `${imports} import * as Router from 'react-router-dom';
    const First = RouterLink; const Second = First; const Third = Router.NavLink;
    <><Second to="/inbox">Inbox</Second><Third to="/settings">Settings</Third></>`;
  assert.equal(parkLinkCompositionFailures(dashboard, jsx).length, 2);
});

test('rejects uncomposed native and router links, including nested asChild descendants', () => {
  const jsx = `${imports}
    <><a href="/help">Help</a><RouterLink to="/inbox">Inbox</RouterLink>
    <NavLink to="/settings">Settings</NavLink>
    <ParkLink asChild><span><RouterLink to="/hidden">Nested</RouterLink></span></ParkLink></>`;
  assert.deepEqual(parkLinkCompositionFailures(dashboard, jsx).map(message => message.split(': ')[0]), [
    'Uncomposed native anchor in active application source',
    'Uncomposed router link in active application source',
    'Uncomposed router link in active application source',
    'Uncomposed router link in active application source',
  ]);
});

test('accepts only the parent-focused Inbox option link with explicit tabIndex=-1', () => {
  const row = `${imports}<article role="option" tabIndex={focused ? 0 : -1} onKeyDown={move}>
    <div><RouterLink to="/inbox/all/ticket-1" tabIndex={-1}>Ticket</RouterLink></div>
  </article>`;
  assert.deepEqual(parkLinkCompositionFailures('apps/dashboard/src/pages/InboxWorkspacePage.tsx', row), []);
  assert.equal(parkLinkCompositionFailures(dashboard, row).length, 1);
  assert.equal(parkLinkCompositionFailures('apps/dashboard/src/pages/InboxWorkspacePage.tsx', row.replace('tabIndex={-1}>Ticket', '>Ticket')).length, 1);
  assert.equal(parkLinkCompositionFailures('apps/dashboard/src/pages/InboxWorkspacePage.tsx', row.replace('role="option"', 'role="listitem"')).length, 1);
});

test('recognises namespaced React Router imports but not installed Park Link as a router link', () => {
  const jsx = `import * as Router from 'react-router-dom'; import { Link } from '@luminatick/ui/components';
    <><Router.Link to="/inbox">Inbox</Router.Link><Link href="/help">Help</Link></>`;
  assert.equal(parkLinkCompositionFailures(dashboard, jsx).length, 1);
});
