"use client";
import VesselSelect from "@/app/components/VesselSelect";

import { useEffect, useState } from "react";
import { Check, KeyRound, LoaderCircle, Pencil, Plus, ShieldCheck, ToggleLeft, ToggleRight, Trash2, UserRound, X } from "lucide-react";
import { ToastNotice, type Notice } from "@/app/components/ToastNotice";
import { useI18n } from "@/lib/i18n";
import { UserAvatar } from "@/app/components/UserAvatar";
import "../globals.css";

type Role = { id: string; name: string; description: string; permissions: string[]; system: boolean };
type Permission = { id: string; area: string; action: string };
type ManagedUser = { id: string; username: string; email: string | null; avatarUrl: string | null; role: string; roleName?: string; enabled: number; createdAt?: string };

export default function UsersPage() {
  const { language } = useI18n();
  const es = language === "es";
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissionCatalog, setPermissionCatalog] = useState<Permission[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState("operator");
  const [passwordMinLength, setPasswordMinLength] = useState(10);
  const [passwordRequireStrong, setPasswordRequireStrong] = useState(false);
  const [creating, setCreating] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  const [editUser, setEditUser] = useState<ManagedUser | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState("operator");
  const [editEnabled, setEditEnabled] = useState(true);
  const [editPassword, setEditPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<ManagedUser | null>(null);
  const [busyId, setBusyId] = useState("");
  const [roleEditor, setRoleEditor] = useState<Role | "new" | null>(null);
  const [roleName, setRoleName] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [rolePermissions, setRolePermissions] = useState<string[]>([]);
  const [roleSaving, setRoleSaving] = useState(false);
  const [roleDeleting, setRoleDeleting] = useState<Role | null>(null);

  async function refreshUsers() {
    const [usersResponse, authResponse, rolesResponse] = await Promise.all([
      fetch("/api/users", { cache: "no-store" }),
      fetch("/api/auth", { cache: "no-store" }),
      fetch("/api/roles", { cache: "no-store" }),
    ]);
    const data = await usersResponse.json();
    if (!usersResponse.ok) throw new Error(data.error ?? (es ? "No se pudieron cargar los usuarios." : "Could not load users."));
    setUsers(data.data ?? []);
    setPasswordMinLength(data.passwordPolicy?.passwordMinLength ?? 10);
    setPasswordRequireStrong(Boolean(data.passwordPolicy?.passwordRequireStrong));
    const auth = await authResponse.json();
    setCurrentUserId(auth.user?.id ?? "");
    if (rolesResponse.ok) {
      const roleData = await rolesResponse.json();
      setRoles(roleData.data ?? []);
      setPermissionCatalog(roleData.permissions ?? []);
    }
  }

  useEffect(() => {
    void refreshUsers().catch((error) => setNotice({ kind: "error", title: error instanceof Error ? error.message : (es ? "No se pudieron cargar los usuarios." : "Could not load users.") }));
  }, [language]);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!username.trim() || !password || creating) return;
    const normalizedEmail = email.trim();
    if (normalizedEmail && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254)) {
      setNotice({ kind: "error", title: es ? "La dirección de correo no es válida." : "Email address is not valid." });
      return;
    }
    setCreating(true);
    try {
      const response = await fetch("/api/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: username.trim(), email: normalizedEmail, password, role: newUserRole }), cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? (es ? "No se pudo crear el usuario." : "Could not create user."));
      setUsername(""); setEmail(""); setPassword("");
      await refreshUsers();
      setNotice({ kind: "success", title: es ? "Usuario creado" : "User created", detail: data.data.username });
    } catch (error) {
      const message = error instanceof Error ? error.message : (es ? "No se pudo conectar con el servidor." : "Unable to reach the server.");
      setNotice({ kind: "error", title: es && message === "Email address is not valid" ? "La dirección de correo no es válida." : message });
    } finally { setCreating(false); }
  }

  function openEdit(user: ManagedUser) {
    setEditUser(user); setEditUsername(user.username); setEditEmail(user.email ?? ""); setEditRole(user.role); setEditEnabled(Boolean(user.enabled)); setEditPassword("");
  }

  function openRoleEditor(role: Role | "new") {
    setRoleEditor(role);
    setRoleName(role === "new" ? "" : role.name);
    setRoleDescription(role === "new" ? "" : role.description);
    setRolePermissions(role === "new" ? [] : [...role.permissions]);
  }

  async function saveRole(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!roleEditor || roleSaving) return;
    setRoleSaving(true);
    try {
      const editing = roleEditor !== "new";
      const response = await fetch("/api/roles", { method: editing ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...(editing ? { id: roleEditor.id } : {}), name: roleName, description: roleDescription, permissions: rolePermissions }), cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? (es ? "No se pudo guardar el rol." : "Could not save role."));
      setRoleEditor(null); await refreshUsers();
      setNotice({ kind: "success", title: es ? (editing ? "Rol actualizado" : "Rol creado") : (editing ? "Role updated" : "Role created"), detail: data.data.name });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save role.";
      setNotice({ kind: "error", title: es ? translateError(message) : message });
    } finally { setRoleSaving(false); }
  }

  async function removeRole() {
    if (!roleDeleting || roleSaving) return;
    setRoleSaving(true);
    try {
      const response = await fetch("/api/roles", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: roleDeleting.id }), cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not delete role.");
      const name = roleDeleting.name; setRoleDeleting(null); await refreshUsers();
      setNotice({ kind: "success", title: es ? "Rol eliminado" : "Role deleted", detail: name });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not delete role.";
      setNotice({ kind: "error", title: es ? translateError(message) : message });
    } finally { setRoleSaving(false); }
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editUser || saving) return;
    setSaving(true);
    try {
      const response = await fetch("/api/users", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: editUser.id, username: editUsername.trim(), email: editEmail.trim(), role: editRole, enabled: editEnabled, password: editPassword || undefined }), cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? (es ? "No se pudo actualizar el usuario." : "Could not update user."));
      setEditUser(null); await refreshUsers();
      setNotice({ kind: "success", title: es ? "Usuario actualizado" : "User updated", detail: data.data.username });
      if (editPassword && editUser.id === currentUserId) setNotice({ kind: "success", title: es ? "Contraseña actualizada · inicia sesión de nuevo" : "Password updated · sign in again" });
    } catch (error) {
      const message = error instanceof Error ? error.message : (es ? "No se pudo actualizar el usuario." : "Could not update user.");
      setNotice({ kind: "error", title: es ? translateError(message) : message });
    } finally { setSaving(false); }
  }

  function translateError(message: string) {
    const translations: Record<string, string> = {
      "Email address is not valid": "La dirección de correo no es válida.",
      "At least one active administrator is required.": "Debe quedar al menos un administrador activo.",
      "You cannot disable or demote your own administrator account.": "No puedes desactivar ni cambiar el rol de tu propia cuenta administradora.",
      "You cannot delete your own account.": "No puedes eliminar tu propia cuenta.",
      "Username must be 3–64 letters, numbers, dots, dashes, or underscores.": "El usuario debe tener entre 3 y 64 caracteres: letras, números, punto, guion o guion bajo.",
      "Choose a valid user role.": "Selecciona un rol válido.",
      "Reassign users before deleting this role.": "Reasigna a los usuarios antes de eliminar este rol.",
      "Role name must contain 2–48 printable characters.": "El nombre del rol debe tener entre 2 y 48 caracteres.",
      "Choose valid permissions.": "Selecciona permisos válidos.",
      "A role with this name already exists.": "Ya existe un rol con ese nombre.",
    };
    return translations[message] ?? message;
  }

  function roleLabel(roleId: string, roleNameValue?: string) {
    if (es) return ({ administrator: "Administrador", operator: "Operador", viewer: "Lector" } as Record<string, string>)[roleId] ?? roleNameValue ?? roles.find((role) => role.id === roleId)?.name ?? roleId;
    return roleNameValue ?? roles.find((role) => role.id === roleId)?.name ?? roleId;
  }

  async function toggleEnabled(user: ManagedUser) {
    setBusyId(user.id);
    try {
      const response = await fetch("/api/users", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: user.id, username: user.username, email: user.email ?? "", role: user.role, enabled: !user.enabled }), cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not update user.");
      await refreshUsers();
      setNotice({ kind: "success", title: es ? (user.enabled ? "Usuario desactivado" : "Usuario activado") : (user.enabled ? "User deactivated" : "User activated"), detail: user.username });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update user.";
      setNotice({ kind: "error", title: es ? translateError(message) : message });
    } finally { setBusyId(""); }
  }

  async function removeUser() {
    if (!deleting || busyId) return;
    setBusyId(deleting.id);
    try {
      const response = await fetch("/api/users", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: deleting.id }), cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not delete user.");
      const username = deleting.username; setDeleting(null); await refreshUsers();
      setNotice({ kind: "success", title: es ? "Usuario eliminado" : "User deleted", detail: username });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not delete user.";
      setNotice({ kind: "error", title: es ? translateError(message) : message });
    } finally { setBusyId(""); }
  }

  return <main className="module-main users-page">
    <ToastNotice notice={notice} onClose={() => setNotice(null)} />
    <header className="module-header"><div><span className="module-kicker">Vessel · Security</span><h1>{es ? "Usuarios y roles" : "Users and roles"}</h1><p>{es ? "Administra operadores y lectores del plano de control." : "Manage operators and viewers of the control plane."}</p></div><span className="module-header-badge"><ShieldCheck size={15} />{es ? "Control de acceso" : "Access control"}</span></header>
    <section className="module-panel">
      <div className="module-section-title"><div><strong>{es ? "Nuevo usuario" : "New user"}</strong><small>{es ? "Correo opcional: permite mostrar el avatar de Gravatar." : "Optional email: used to display the user's Gravatar."}</small></div></div>
      <form className="module-form users-create-form" noValidate onSubmit={(event) => void create(event)}>
        <label><span>{es ? "Usuario" : "Username"}<b className="field-required" aria-hidden="true"> *</b></span><input required autoComplete="username" placeholder="operator" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
        <label><span>{es ? "Correo (opcional)" : "Email (optional)"}</span><input placeholder="name@example.com" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label><span>{es ? "Contraseña" : "Password"}<b className="field-required" aria-hidden="true"> *</b></span><input required autoComplete="new-password" placeholder={es ? `Mínimo ${passwordMinLength} caracteres` : `${passwordMinLength} characters minimum`} type="password" value={password} onChange={(event) => setPassword(event.target.value)} /><small>{passwordRequireStrong ? (es ? "Incluye mayúscula, minúscula, número y símbolo." : "Include uppercase, lowercase, a number, and a symbol.") : ""}</small></label>
        <label><span>{es ? "Rol" : "Role"}<b className="field-required" aria-hidden="true"> *</b></span><VesselSelect value={newUserRole} onChange={(event) => setNewUserRole(event.target.value)}>{roles.map((role) => <option key={role.id} value={role.id}>{roleLabel(role.id, role.name)}</option>)}</VesselSelect></label>
        <button className="primary-button users-create-button" type="submit" disabled={creating || !username.trim() || !password}>{creating ? <LoaderCircle size={17} className="spinning" /> : <Plus size={17} />}{creating ? (es ? "Creando…" : "Creating…") : (es ? "Crear usuario" : "Create user")}</button>
      </form>
      <div className="module-section-title list-heading"><div><strong>{es ? "Cuentas registradas" : "Registered accounts"}</strong><small>{users.length} {es ? "cuenta(s)" : "account(s)"}</small></div></div>
      <div className="account-grid">{users.map((user) => <article className={`account-card${user.enabled ? "" : " is-disabled"}`} key={user.id}>
        <UserAvatar className="account-avatar large" username={user.username} avatarUrl={user.avatarUrl} />
        <div className="account-card-identity"><strong>{user.username}</strong><small>{user.email || (es ? "Sin correo" : "No email")}</small><span className={`account-status ${user.enabled ? "is-active" : "is-inactive"}`}><i />{user.enabled ? (es ? "Activo" : "Active") : (es ? "Inactivo" : "Inactive")}</span></div>
        <span className="role-badge">{roleLabel(user.role, user.roleName)}</span>
        <div className="account-actions">
          <button type="button" onClick={() => openEdit(user)} aria-label={es ? `Editar ${user.username}` : `Edit ${user.username}`} title={es ? "Editar usuario" : "Edit user"}><Pencil size={15} /></button>
          <button type="button" onClick={() => void toggleEnabled(user)} disabled={busyId === user.id || user.id === currentUserId} aria-label={user.enabled ? (es ? "Desactivar usuario" : "Deactivate user") : (es ? "Activar usuario" : "Activate user")} title={user.id === currentUserId ? (es ? "No puedes desactivar tu propia cuenta" : "You cannot deactivate your own account") : user.enabled ? (es ? "Desactivar" : "Deactivate") : (es ? "Activar" : "Activate")}>{user.enabled ? <ToggleRight size={17} /> : <ToggleLeft size={17} />}</button>
          <button type="button" className="is-danger" onClick={() => setDeleting(user)} disabled={user.id === currentUserId} aria-label={es ? `Eliminar ${user.username}` : `Delete ${user.username}`} title={user.id === currentUserId ? (es ? "No puedes eliminar tu propia cuenta" : "You cannot delete your own account") : (es ? "Eliminar usuario" : "Delete user")}><Trash2 size={15} /></button>
        </div>
      </article>)}</div>
      <div className="module-section-title list-heading roles-heading"><div><strong>{es ? "Roles y permisos" : "Roles and permissions"}</strong><small>{es ? "Crea perfiles de acceso y asígnalos a los usuarios." : "Create access profiles and assign them to users."}</small></div><button type="button" className="secondary-button" onClick={() => openRoleEditor("new")}><Plus size={15} />{es ? "Crear rol" : "Create role"}</button></div>
      <div className="access-role-grid">{roles.map((role) => <article className="access-role-card" key={role.id}><div className="access-role-copy"><span className="access-role-icon"><ShieldCheck size={17} /></span><div><strong>{roleLabel(role.id, role.name)}</strong><small>{role.description || (es ? "Sin descripción" : "No description")}</small></div></div><span className="access-role-count">{role.permissions.includes("*") ? (es ? "Acceso total" : "Full access") : `${role.permissions.length} ${es ? "permisos" : "permissions"}`}</span>{role.system ? <span className="role-system-badge">{es ? "Integrado" : "Built-in"}</span> : <div className="account-actions"><button type="button" onClick={() => openRoleEditor(role)} title={es ? "Editar rol" : "Edit role"} aria-label={es ? "Editar rol" : "Edit role"}><Pencil size={15} /></button><button type="button" className="is-danger" onClick={() => setRoleDeleting(role)} title={es ? "Eliminar rol" : "Delete role"} aria-label={es ? "Eliminar rol" : "Delete role"}><Trash2 size={15} /></button></div>}</article>)}</div>
    </section>
    {editUser ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setEditUser(null); }}><section className="confirm-modal users-edit-modal" role="dialog" aria-modal="true" aria-labelledby="users-edit-title"><span className="modal-kicker"><UserRound size={15} />{es ? "Administración de cuentas" : "Account administration"}</span><h2 id="users-edit-title"><Pencil size={18} />{es ? `Editar ${editUser.username}` : `Edit ${editUser.username}`}</h2><form className="users-edit-form" onSubmit={(event) => void saveEdit(event)}>
      <label><span>{es ? "Nombre de usuario" : "Username"} *</span><input required minLength={3} maxLength={64} value={editUsername} onChange={(event) => setEditUsername(event.target.value)} /></label>
      <label><span>{es ? "Correo (opcional)" : "Email (optional)"}</span><input type="email" value={editEmail} onChange={(event) => setEditEmail(event.target.value)} placeholder="name@example.com" /></label>
      <label><span>{es ? "Rol" : "Role"}</span><VesselSelect value={editRole} onChange={(event) => setEditRole(event.target.value)} disabled={editUser.id === currentUserId}>{roles.map((role) => <option key={role.id} value={role.id}>{roleLabel(role.id, role.name)}</option>)}</VesselSelect></label>
      <label className="users-edit-password"><span><KeyRound size={14} />{es ? "Nueva contraseña (opcional)" : "New password (optional)"}</span><input type="password" autoComplete="new-password" minLength={passwordMinLength} value={editPassword} onChange={(event) => setEditPassword(event.target.value)} placeholder={es ? "Dejar en blanco para conservarla" : "Leave blank to keep current password"} />{passwordRequireStrong && editPassword ? <small>{es ? "Incluye mayúscula, minúscula, número y símbolo." : "Include uppercase, lowercase, a number, and a symbol."}</small> : null}</label>
      <label className="users-edit-enabled"><input type="checkbox" checked={editEnabled} onChange={(event) => setEditEnabled(event.target.checked)} disabled={editUser.id === currentUserId} /><span>{es ? "Cuenta activa" : "Account active"}</span></label>
      {editPassword && editUser.id === currentUserId ? <p className="users-session-note">{es ? "Al cambiar tu propia contraseña se cerrarán las sesiones y tendrás que iniciar sesión de nuevo." : "Changing your own password revokes sessions and requires you to sign in again."}</p> : null}
      <div className="modal-actions"><button type="button" onClick={() => setEditUser(null)} disabled={saving}><X size={15} />{es ? "Cancelar" : "Cancel"}</button><button className="primary-button" type="submit" disabled={saving || !editUsername.trim()}>{saving ? <LoaderCircle size={15} className="spinning" /> : <Check size={15} />}{saving ? (es ? "Guardando…" : "Saving…") : (es ? "Guardar cambios" : "Save changes")}</button></div>
    </form></section></div> : null}
    {roleEditor ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !roleSaving) setRoleEditor(null); }}><section className="confirm-modal role-editor-modal" role="dialog" aria-modal="true" aria-labelledby="role-editor-title"><span className="modal-kicker"><ShieldCheck size={15} />{es ? "Control de acceso" : "Access control"}</span><h2 id="role-editor-title">{roleEditor === "new" ? (es ? "Crear rol" : "Create role") : (es ? "Editar rol" : "Edit role")}</h2><p>{es ? "Selecciona únicamente los permisos que esta función necesita. La administración de usuarios y roles permanece reservada al administrador." : "Grant only the permissions this role needs. User and role administration stays restricted to administrators."}</p><form className="role-editor-form" onSubmit={(event) => void saveRole(event)}><label><span>{es ? "Nombre del rol" : "Role name"} *</span><input required minLength={2} maxLength={48} value={roleName} onChange={(event) => setRoleName(event.target.value)} placeholder={es ? "Ej. Operador de despliegues" : "e.g. Deployment operator"} /></label><label><span>{es ? "Descripción" : "Description"}</span><input maxLength={240} value={roleDescription} onChange={(event) => setRoleDescription(event.target.value)} placeholder={es ? "Qué puede hacer este rol" : "What this role can do"} /></label><div className="role-permission-heading"><strong>{es ? "Permisos" : "Permissions"}</strong><small>{rolePermissions.length} {es ? "seleccionados" : "selected"}</small></div><div className="role-permission-grid">{[...new Set(permissionCatalog.map((permission) => permission.area))].map((area) => <fieldset className="role-permission-group" key={area}><legend>{permissionAreaLabel(area, es)}</legend>{permissionCatalog.filter((permission) => permission.area === area).map((permission) => <label key={permission.id}><input type="checkbox" checked={rolePermissions.includes(permission.id)} onChange={(event) => setRolePermissions((current) => event.target.checked ? [...current, permission.id] : current.filter((value) => value !== permission.id))} /><span>{permissionActionLabel(permission.action, es)}</span></label>)}</fieldset>)}</div><div className="modal-actions"><button type="button" onClick={() => setRoleEditor(null)} disabled={roleSaving}><X size={15} />{es ? "Cancelar" : "Cancel"}</button><button className="primary-button" type="submit" disabled={roleSaving || roleName.trim().length < 2}>{roleSaving ? <LoaderCircle size={15} className="spinning" /> : <Check size={15} />}{roleSaving ? (es ? "Guardando…" : "Saving…") : (es ? "Guardar rol" : "Save role")}</button></div></form></section></div> : null}
    {roleDeleting ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !roleSaving) setRoleDeleting(null); }}><section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="role-delete-title"><span className="modal-kicker"><Trash2 size={15} />{es ? "Eliminar rol" : "Delete role"}</span><h2 id="role-delete-title">{es ? `¿Eliminar ${roleDeleting.name}?` : `Delete ${roleDeleting.name}?`}</h2><p>{es ? "No se puede eliminar mientras haya usuarios asignados. Reasígnalos primero." : "A role cannot be deleted while users are assigned to it. Reassign them first."}</p><div className="modal-actions"><button type="button" onClick={() => setRoleDeleting(null)} disabled={roleSaving}><X size={15} />{es ? "Cancelar" : "Cancel"}</button><button type="button" className="danger-button" onClick={() => void removeRole()} disabled={roleSaving}><Trash2 size={15} />{roleSaving ? (es ? "Eliminando…" : "Deleting…") : (es ? "Eliminar rol" : "Delete role")}</button></div></section></div> : null}
    {deleting ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyId) setDeleting(null); }}><section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="users-delete-title"><span className="modal-kicker"><Trash2 size={15} />{es ? "Eliminar cuenta" : "Delete account"}</span><h2 id="users-delete-title">{es ? `¿Eliminar a ${deleting.username}?` : `Delete ${deleting.username}?`}</h2><p>{es ? "Se eliminarán sus sesiones activas y tokens API. Esta acción no se puede deshacer." : "Their active sessions and API tokens will be revoked. This action cannot be undone."}</p><div className="modal-actions"><button type="button" onClick={() => setDeleting(null)} disabled={Boolean(busyId)}><X size={15} />{es ? "Cancelar" : "Cancel"}</button><button type="button" className="danger-button" onClick={() => void removeUser()} disabled={Boolean(busyId)}><Trash2 size={15} />{busyId ? (es ? "Eliminando…" : "Deleting…") : (es ? "Eliminar usuario" : "Delete user")}</button></div></section></div> : null}
  </main>;
}

function permissionAreaLabel(area: string, es: boolean) {
  const labels: Record<string, [string, string]> = { overview: ["Resumen", "Overview"], containers: ["Contenedores", "Containers"], images: ["Imágenes", "Images"], volumes: ["Volúmenes", "Volumes"], networks: ["Redes", "Networks"], compose: ["Compose", "Compose"], projects: ["Proyectos", "Projects"], deployments: ["Despliegues", "Deployments"], monitoring: ["Monitoreo", "Monitoring"], automation: ["Vessel Run", "Vessel Run"], registries: ["Registries", "Registries"], git: ["Proveedores Git", "Git providers"], servers: ["Servidores", "Servers"], settings: ["Configuración", "Settings"], ai: ["IA", "AI"], audit: ["Auditoría", "Audit"] };
  return labels[area]?.[es ? 0 : 1] ?? area;
}

function permissionActionLabel(action: string, es: boolean) {
  const labels: Record<string, [string, string]> = { view: ["Ver", "View"], manage: ["Administrar", "Manage"], logs: ["Ver logs", "View logs"], ssh_keys: ["Administrar claves SSH", "Manage SSH keys"] };
  return labels[action]?.[es ? 0 : 1] ?? action;
}
