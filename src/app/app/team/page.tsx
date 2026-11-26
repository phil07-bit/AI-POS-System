import { redirect } from "next/navigation";
import { getStaffPageContext } from "@/lib/auth/next";
import { listMembers, listRoles } from "@/server/services/organization.service";
import { listProperties } from "@/server/services/property.service";
import { listTenants } from "@/server/services/tenant.service";
import { PageHeader, Card, StatusBadge, Badge } from "@/components/ui";
import { Table, Th, Td } from "@/components/ui/table";
import { InviteForm, MemberControls } from "@/components/forms/team-forms";
import { ActionButton } from "@/components/forms/action-button";
import { formatDateTime } from "@/lib/dates";
import { ROLE_DEFINITIONS } from "@/lib/permissions";

export const metadata = { title: "Team & roles" };
export default async function Page() {
  const ctx = await getStaffPageContext();
  if (!ctx.permissions.has("user.invite") && !ctx.permissions.has("user.manage")) redirect("/app");
  const [{ members, invitations }, roles, props, tenants] = await Promise.all([listMembers(ctx), listRoles(), listProperties(ctx, { pageSize: 100 }), ctx.permissions.has("tenant.read") ? listTenants(ctx, { pageSize: 100 }) : Promise.resolve({ items: [] })]);
  return (
    <div>
      <PageHeader title="Team & roles" subtitle="Members, their roles and property scope. Permissions are enforced on the server for every request." />
      <Card title={`Members (${members.length})`} padded={false}>
        <Table><thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Scope</Th><Th>Status</Th><Th>Last sign-in</Th>{ctx.permissions.has("user.manage") && <Th>Manage</Th>}</tr></thead>
          <tbody className="divide-y divide-slate-100">{members.map((m) => (
            <tr key={m.id}>
              <Td className="font-medium">{m.user.fullName}</Td><Td>{m.user.email}</Td><Td>{m.role.name}</Td>
              <Td className="text-xs">{m.tenant ? <>Tenant portal: {m.tenant.displayName}</> : m.scopeAllProperties ? "All properties" : m.propertyScopes.map((s) => s.property.name).join(", ") || "No properties"}</Td>
              <Td><StatusBadge status={m.status} /></Td><Td className="text-xs">{formatDateTime(m.user.lastLoginAt, ctx.timezone)}</Td>
              {ctx.permissions.has("user.manage") && <Td><MemberControls membershipId={m.id} roleKey={m.role.key} status={m.status} roles={roles} myRank={ctx.roleRank} isSelf={m.userId === ctx.userId} /></Td>}
            </tr>
          ))}</tbody></Table>
      </Card>
      {invitations.length > 0 && (
        <Card title="Pending invitations" className="mt-4" padded={false}>
          <Table><thead><tr><Th>Email</Th><Th>Role</Th><Th>Expires</Th><Th /></tr></thead>
            <tbody className="divide-y divide-slate-100">{invitations.map((i) => <tr key={i.id}><Td>{i.email}</Td><Td>{i.role.name}</Td><Td>{formatDateTime(i.expiresAt, ctx.timezone)}</Td><Td>{ctx.permissions.has("user.invite") && <ActionButton endpoint={`/invitations/${i.id}`} label="Revoke" variant="ghost" />}</Td></tr>)}</tbody></Table>
        </Card>
      )}
      {ctx.permissions.has("user.invite") && (
        <Card title="Invite a team member or tenant" className="mt-4">
          <InviteForm orgId={ctx.organizationId} roles={roles} properties={props.items.map((p) => ({ id: p.id, name: p.name }))} tenants={tenants.items.map((t) => ({ id: t.id, name: t.displayName }))} myRank={ctx.roleRank} />
        </Card>
      )}
      <Card title="Role reference" className="mt-4">
        <ul className="grid gap-3 md:grid-cols-2">{ROLE_DEFINITIONS.map((r) => (
          <li key={r.key} className="rounded-md border border-slate-100 p-3 text-sm"><div className="font-medium">{r.name}</div><p className="text-xs text-slate-600">{r.description}</p>
            <details className="mt-1 text-xs"><summary className="cursor-pointer text-brand-700">{r.permissions.length} permissions</summary><div className="mt-1 flex flex-wrap gap-1">{r.permissions.map((p) => <Badge key={p}>{p}</Badge>)}</div></details></li>
        ))}</ul>
      </Card>
    </div>
  );
}
