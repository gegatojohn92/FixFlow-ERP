# Feature Blueprint: Role-Aware Navigation, Access-Controlled UI & Mobile Dashboard

## 1. System Overview & Objectives
- FixFlow ERP is a Next.js 16 App Router application using TypeScript 5, Supabase/PostgreSQL with Row Level Security (RLS), Tailwind CSS, Lucide React, PWA support, and `src/proxy.ts` for RBAC/session handling.
- The requested change has three related objectives:
  - Make navigation and form/page entry points role-aware so users only see forms and actions applicable to their assigned role.
  - Make workflows easier to navigate within each role, especially role-specific workflows such as the Purchaser's Form 13 (`/purchaser/queue`) and the Budget Officer's Form 8 (`/mrs/canvass`).
  - Redesign the dashboard shell and dashboard content for reliable mobile rendering.
- The existing handoff already defines the authoritative role-to-route matrix for nine roles. The implementation should centralize that matrix so the dashboard navigation, page-level guards, and action-level authorization do not maintain separate conflicting copies.
- UI hiding is a usability and flow-control requirement, not a security boundary by itself. Direct URL access, server actions, API/data mutations, and Supabase RLS must continue to enforce authorization. The existing `src/proxy.ts`, account-status checks, server actions, and RLS remain part of the defense-in-depth model.
- The implementation should preserve the existing workflow semantics for Forms 1–18, the four-step financial chain of custody, atomic reference-number generation, and the documented Supabase attachment-query constraints.
- The supplied architecture handoff is the available repository context for this blueprint; no additional application source files were supplied for direct inspection. Exact component names beyond those explicitly documented in the handoff should therefore be discovered during implementation rather than invented here.

## 2. File Index & Scope
- **Files to Modify:**
  - `src/app/(dashboard)/layout.tsx` — Make the dashboard shell/navigation responsive and role-aware. Build navigation from the centralized access matrix, hide inaccessible sections/routes, and provide a mobile-friendly navigation pattern.
  - `src/app/(dashboard)/dashboard/` — Audit and modify dashboard page/components so KPI cards, grids, tables, charts, and role-specific content reflow correctly on small screens. Ensure the dashboard only renders role-relevant information/actions.
  - `src/proxy.ts` — Audit route authorization against the same centralized route permissions used by navigation. Preserve Next.js 16 proxy conventions, session refresh, and the `auth.uid()` + `account_status = 'ACTIVE'` guard.
  - `src/types/index.ts` — Add/extend strongly typed role, route, navigation-item, permission, and workflow metadata structures if the existing domain types do not already provide them.
  - `src/app/(dashboard)/jo/*` — Audit page-level navigation/actions and links for Forms 1–4; hide links/buttons that are not available to the current role while retaining server-side authorization.
  - `src/app/(dashboard)/mrs/*` — Audit Forms 5–9 and especially `/mrs/canvass` (Form 8). Provide role-specific navigation/context and remove inaccessible controls from the UI.
  - `src/app/(dashboard)/transmittals/*` — Audit Forms 10–12 and the hub so users see only the transmittal steps relevant to their role.
  - `src/app/(dashboard)/purchaser/queue/` — Optimize Form 13 navigation for `PURCHASER`, including clearer workflow entry/exit points and only relevant actions.
  - `src/app/(dashboard)/delivery/verify/` — Hide/disable workflow controls that are not authorized for the current role while preserving server-side checks.
  - `src/app/(dashboard)/pms/*` — Audit PMS hub/register/daily/aircon navigation against the documented role matrix.
  - `src/app/(dashboard)/reports/expense/` — Hide this analytics entry point from roles outside the documented matrix.
  - `src/app/(dashboard)/admin/users/` — Keep user-management navigation/actions restricted to `SUPER_ADMIN` and `MANAGER` as documented.
  - `src/components/` — Reuse or introduce shared navigation/permission-aware UI primitives here rather than duplicating role checks throughout pages. Audit existing shared cards, buttons, menus, and responsive layout components.
  - `src/globals.css` — Only modify if responsive/dashboard layout requires shared design-token or overflow fixes not appropriately handled in component-level Tailwind classes.
  - `scripts/verify-rls.js` — Extend verification only if needed to cover the role/route security assumptions introduced or exposed by this feature.
- **New Files to Create:**
  - `src/lib/access-control.ts` — Central source of truth for the documented role-to-route/navigation permissions and helper functions such as route visibility checks. Exact API should be derived from the existing type structure during implementation.
  - `src/components/navigation/RoleAwareNavigation.tsx` — Shared role-aware navigation component for desktop/mobile dashboard navigation, if no equivalent component already exists.
  - `src/components/navigation/MobileNavigation.tsx` — Mobile navigation presentation, if separation from the main navigation component improves maintainability.
  - `src/components/dashboard/ResponsiveDashboardShell.tsx` — Only if the current dashboard implementation lacks a suitable reusable responsive shell; otherwise keep the change within existing dashboard components to avoid unnecessary abstraction.
  - `PLAN.md` — This technical blueprint.
  - Tests should be added alongside the project's existing test convention after inspecting the repository; do not assume a test framework or invent a test directory structure.
- **Dependencies/Packages:**
  - No new package is required by the feature based on the supplied architecture.
  - Prefer existing Next.js, React, Tailwind CSS, Lucide React, and PWA infrastructure.
  - Do not add a navigation/UI library unless repository inspection proves an existing requirement cannot be met with the current stack.
  - If a test framework is already installed, use it. If none exists, implementation should first determine whether adding a test dependency is appropriate rather than silently introducing one.

## 3. Step-by-Step Execution Checklist
- [x] Task 1: Inventory the actual dashboard shell, navigation components, page-level links/buttons, permission checks, and existing responsive Tailwind classes across `src/app/(dashboard)`, `src/components`, `src/lib`, and `src/proxy.ts`; identify duplicate or inconsistent role checks before changing behavior.
- [x] Task 2: Confirm the current authentication/session shape used by server and client components, including how the current user's role, department, and `account_status` are obtained. Preserve the documented active-account requirement.
- [x] Task 3: Convert the documented role matrix into a single typed access-control model covering the nine roles and the documented routes/forms. Include `SUPER_ADMIN` as unrestricted while explicitly listing the other roles' routes.
- [x] Task 4: Define reusable authorization predicates for route visibility and navigation grouping. Distinguish `canViewRoute`/navigation visibility from mutation/action authorization so hiding a UI element never becomes the only security control.
- [x] Task 5: Audit `src/proxy.ts` against the centralized permissions and make route protection consistent with the same route definitions, without creating `middleware.ts` and without changing the documented Next.js 16 cookie pattern.
- [x] Task 6: Refactor the dashboard layout/navigation to render only items allowed for the current role. Remove inaccessible forms from menus, dropdowns, quick links, dashboard shortcuts, and other navigation surfaces rather than merely disabling them.
- [x] Task 7: Organize navigation around role-specific workflows. For example, make the Purchaser's primary path lead naturally to Form 13 (`/purchaser/queue`) and related receiving/transmittal steps; make Budget Officer navigation make Form 8 (`/mrs/canvass`) easy to reach; apply equivalent workflow grouping to Maintenance, Storekeeper, Accounting, Front Desk, Manager, Staff, and other roles.
- [x] Task 8: Audit every page for secondary navigation and action controls that can expose inaccessible workflows. Remove unauthorized links/buttons/tabs/cards from Forms 1–18 according to the handoff matrix, while keeping authorized actions intact.
- [x] Task 9: Audit role/department wording and behavior. The documented access matrix is role-based, while some forms are department-oriented; determine from the actual user schema and existing authorization logic whether department restrictions are already encoded. If department-level permissions exist, incorporate them into the access predicate instead of assuming role alone is sufficient.
- [x] Task 10: Redesign the mobile dashboard shell: establish a small-screen navigation pattern, prevent horizontal overflow, make KPI/card grids collapse appropriately, ensure tables/lists can scroll or transform safely, and keep important actions reachable without relying on desktop-only hover behavior.
- [x] Task 11: Audit dashboard typography, spacing, fixed/sticky elements, modal/dropdown positioning, and viewport-height calculations for mobile browsers/PWA mode. Preserve the existing dark/glassmorphic visual language while prioritizing readable content and touch-friendly controls.
- [x] Task 12: Verify that role-aware rendering does not cause hydration mismatches. If role data is loaded asynchronously on the client, establish a stable loading state or move permission-sensitive navigation rendering to a server component where appropriate.
- [x] Task 13: Verify direct URL behavior for every protected route. A hidden menu item must not be treated as proof of authorization; unauthorized users must still be rejected by proxy/server authorization and/or database RLS.
- [x] Task 14: Audit server actions under `src/lib/actions/` (`jo-actions`, `mrs-actions`, `transmittal-actions`, `pms-actions`, `user-actions`) so mutations remain independently authorized for the role and workflow step. Do not weaken the four-step transmittal chain or account-status guard.
- [x] Task 15: Run type checking/build validation and the repository's existing tests. Resolve responsive layout regressions and permission inconsistencies before release.
- [ ] Task 16: Perform a role-by-role acceptance pass using the documented route matrix. Confirm that each role sees only its intended navigation and that `SUPER_ADMIN` retains full access.
- [ ] Task 17: Perform a mobile acceptance pass on narrow phone viewport sizes and touch interaction, including dashboard load, navigation open/close, scrolling, cards, forms, tables, dialogs, and primary workflow actions.
- [x] Task 18: Update any relevant handoff/architecture documentation after implementation so future agents know where the centralized access-control source of truth lives.

Implementation status: Tasks 1-15 and 18 are implemented and statically validated. Tasks 16-17 remain open pending authenticated browser/PWA acceptance across all roles and representative mobile viewports.

The centralized authorization source of truth is `src/lib/access-control.ts`. Route enforcement is applied in `src/proxy.ts`, dashboard navigation is filtered in `src/app/(dashboard)/layout.tsx`, and workflow mutations retain independent server-side checks in `src/lib/actions/`.

## 4. Edge Cases & Safety Checks
- **UI hiding is not authorization:** Users may manually enter URLs or invoke actions. Every protected route and mutation must remain server-side authorized.
- **Role/department mismatch:** The handoff provides a role matrix but the feature request mentions both role and department. Do not infer department permissions. Inspect the actual user model and existing checks before introducing department rules.
- **Multiple roles:** If the database allows only one enum role, use that contract. If a user can have multiple effective permissions through another mechanism, resolve access as the union/intersection explicitly defined by the existing system rather than guessing.
- **Inactive accounts:** Preserve the documented `account_status = 'ACTIVE'` requirement at proxy and server-action boundaries.
- **SUPER_ADMIN:** Preserve unrestricted access as documented.
- **Direct deep links:** An inaccessible route must not become accessible merely because a user knows its URL.
- **Nested routes:** Permission checks must handle child paths consistently, including `/jo/queue/escalated`, `/pms/*`, `/transmittals/*`, and similar route families.
- **Navigation drift:** Avoid hardcoding route permissions independently in multiple components. A centralized matrix should prevent one menu from exposing a route another menu hides.
- **Hydration/state synchronization:** Client-side role loading can briefly show incorrect navigation. Prefer server-derived role data or a deterministic loading state to avoid flashing unauthorized items.
- **PWA/offline cache:** Cached application shells or navigation state must not be treated as an authorization mechanism. Avoid persisting role-sensitive UI in a way that can display stale permissions after an account/role change.
- **Account role changes:** After an administrator changes a user's role, the next request/session must obtain the updated role; stale client state should not grant access.
- **Mobile overflow:** Long form names, tables, status badges, and requester/department fields may create horizontal overflow. Use responsive wrapping/scrolling deliberately rather than clipping critical information.
- **Touch targets:** Navigation and primary actions should remain comfortably tappable on small screens.
- **Tables and dense forms:** Do not simply shrink desktop tables until unusable. Where appropriate, use horizontal scrolling or a mobile card/list representation without changing workflow data.
- **Fixed/sticky UI:** Validate sticky headers, bottom navigation, drawers, dialogs, and viewport height on mobile Safari/Chrome and PWA standalone mode.
- **Chain of custody:** Navigation refactoring must not alter sender/receiver confirmation semantics for transmittals.
- **Supabase RLS:** Continue using `get_my_role()` for `users`-table policies to avoid the documented recursion issue.
- **Attachments:** Do not introduce embedded PostgREST joins to `attachments`; the existing separate-query/merge pattern remains required.
- **Reference numbers:** Do not alter reference-number generation while changing navigation.
- **Visual regression:** Existing photo lightboxes, status badges, cards, and workflow panels must remain usable after responsive changes.

## 5. Verification & Testing Steps
- Start with dependency/install validation:
  - `npm install`
- Run development mode and manually inspect role-aware navigation:
  - `npm run dev`
- Validate the production build:
  - `npm run build`
- If the repository exposes a type-check script, run it; otherwise use the project's existing TypeScript/build validation rather than inventing a command.
- If a test framework is present, run its existing test command and add focused coverage for:
  - Each role's route visibility against the documented matrix.
  - Nested route matching (`/jo/*`, `/mrs/*`, `/pms/*`, `/transmittals/*`).
  - `SUPER_ADMIN` unrestricted access.
  - Inactive-account denial.
  - Unauthorized direct URL rejection.
  - Server-action authorization for representative mutations.
  - Navigation behavior before and after a role change/session refresh.
- Run `node scripts/verify-rls.js` and `node scripts/verify-schema.js` where their existing scripts support the environment, confirming that RBAC changes did not weaken database controls.
- Browser acceptance matrix:
  - `SUPER_ADMIN`: verify all documented navigation groups/routes are visible.
  - `MANAGER`: verify only dashboard, JO creation/tracking/queue, MRS manager queue, PMS, reports, and user management surfaces documented for the role.
  - `BUDGET_OFFICER`: verify Form 8 (`/mrs/canvass`) and relevant transmittal/report surfaces are prominent and unrelated forms are hidden.
  - `ACCOUNTING`: verify Form 11 and relevant tracking/report surfaces are visible; purchasing/maintenance-only forms are hidden.
  - `PURCHASER`: verify Form 13 is a primary workflow entry and Forms 14/transmittal access is exposed only as documented.
  - `STOREKEEPER`: verify stock-check and receiving surfaces are visible and unrelated queues are hidden.
  - `MAINTENANCE`: verify JO and PMS workflow surfaces are prominent and unrelated financial/purchasing pages are hidden.
  - `FRONT_DESK`: verify JO/transmittal/front-desk/delivery workflow surfaces are visible as documented.
  - `STAFF`: verify dashboard, JO new/track, and MRS new are visible while restricted queues and administration are hidden.
- Direct URL/security checks for every route in Forms 1–18: test an unauthorized role by entering the URL manually and confirm the server/proxy rejects access even though the navigation is hidden.
- Mobile viewport checks at representative narrow widths (for example, ~320px, ~375px, and ~430px) and a desktop width. Verify no unexpected horizontal page scroll, clipped dashboard cards, inaccessible menus, or unusable forms.
- Test both browser mode and installed/PWA standalone mode because the project uses a service worker and manifest.
- Test after session refresh/login and after role/account-status changes to detect stale permission state.
- Record any route in the actual repository that differs from the handoff matrix before implementation; resolve discrepancies explicitly rather than silently changing the documented access model.
