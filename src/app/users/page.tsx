"use client";

import { useEffect, useState } from "react";
import { Check, KeyRound, LoaderCircle, Pencil, Plus, ShieldCheck, ToggleLeft, ToggleRight, Trash2, UserRound, X } from "lucide-react";
import { ToastNotice, type Notice } from "@/app/components/ToastNotice";
import { useI18n } from "@/lib/i18n";
import { UserAvatar } from "@/app/components/UserAvatar";
import "../globals.css";

type ManagedUser = { id: string; username: string; email: string | null; avatarUrl: string | null; role: "administrator" | "operator" | "viewer"; enabled: number; createdAt?: string };

export default function UsersPage() {
  const { language } = useI18n();
  const es = language === "es";
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordMinLength, setPasswordMinLength] = useState(10);
  const [passwordRequireStrong, setPasswordRequireStrong] = useState(false);
  const [creating, setCreating] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  const [editUser, setEditUser] = useState<ManagedUser | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<ManagedUser["role"]>("operator");
  const [editEnabled, setEditEnabled] = useState(true);
  const [editPassword, setEditPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<ManagedUser | null>(null);
  const [busyId, setBusyId] = useState("");

  async function refreshUsers() {
    const [usersResponse, authResponse] = await Promise.all([
      fetch("/api/users", { cache: "no-store" }),
      fetch("/api/auth", { cache: "no-store" }),
    ]);
    const data = await usersResponse.json();
    if (!usersResponse.ok) throw new Error(data.error ?? (es ? "No se pudieron cargar los usuarios." : "Could not load users."));
    setUsers(data.data ?? []);
    setPasswordMinLength(data.passwordPolicy?.passwordMinLength ?? 10);
    setPasswordRequireStrong(Boolean(data.passwordPolicy?.passwordRequireStrong));
    const auth = await authResponse.json();
    setCurrentUserId(auth.user?.id ?? "");
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
      const response = await fetch("/api/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: username.trim(), email: normalizedEmail, password, role: "operator" }), cache: "no-store" });
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
    };
    return translations[message] ?? message;
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
        <button className="primary-button users-create-button" type="submit" disabled={creating || !username.trim() || !password}>{creating ? <LoaderCircle size={17} className="spinning" /> : <Plus size={17} />}{creating ? (es ? "Creando…" : "Creating…") : (es ? "Crear usuario" : "Create user")}</button>
      </form>
      <div className="module-section-title list-heading"><div><strong>{es ? "Cuentas registradas" : "Registered accounts"}</strong><small>{users.length} {es ? "cuenta(s)" : "account(s)"}</small></div></div>
      <div className="account-grid">{users.map((user) => <article className={`account-card${user.enabled ? "" : " is-disabled"}`} key={user.id}>
        <UserAvatar className="account-avatar large" username={user.username} avatarUrl={user.avatarUrl} />
        <div className="account-card-identity"><strong>{user.username}</strong><small>{user.email || (es ? "Sin correo" : "No email")}</small><span className={`account-status ${user.enabled ? "is-active" : "is-inactive"}`}><i />{user.enabled ? (es ? "Activo" : "Active") : (es ? "Inactivo" : "Inactive")}</span></div>
        <span className="role-badge">{user.role}</span>
        <div className="account-actions">
          <button type="button" onClick={() => openEdit(user)} aria-label={es ? `Editar ${user.username}` : `Edit ${user.username}`} title={es ? "Editar usuario" : "Edit user"}><Pencil size={15} /></button>
          <button type="button" onClick={() => void toggleEnabled(user)} disabled={busyId === user.id || user.id === currentUserId} aria-label={user.enabled ? (es ? "Desactivar usuario" : "Deactivate user") : (es ? "Activar usuario" : "Activate user")} title={user.id === currentUserId ? (es ? "No puedes desactivar tu propia cuenta" : "You cannot deactivate your own account") : user.enabled ? (es ? "Desactivar" : "Deactivate") : (es ? "Activar" : "Activate")}>{user.enabled ? <ToggleRight size={17} /> : <ToggleLeft size={17} />}</button>
          <button type="button" className="is-danger" onClick={() => setDeleting(user)} disabled={user.id === currentUserId} aria-label={es ? `Eliminar ${user.username}` : `Delete ${user.username}`} title={user.id === currentUserId ? (es ? "No puedes eliminar tu propia cuenta" : "You cannot delete your own account") : (es ? "Eliminar usuario" : "Delete user")}><Trash2 size={15} /></button>
        </div>
      </article>)}</div>
    </section>
    {editUser ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setEditUser(null); }}><section className="confirm-modal users-edit-modal" role="dialog" aria-modal="true" aria-labelledby="users-edit-title"><span className="modal-kicker"><UserRound size={15} />{es ? "Administración de cuentas" : "Account administration"}</span><h2 id="users-edit-title"><Pencil size={18} />{es ? `Editar ${editUser.username}` : `Edit ${editUser.username}`}</h2><form className="users-edit-form" onSubmit={(event) => void saveEdit(event)}>
      <label><span>{es ? "Nombre de usuario" : "Username"} *</span><input required minLength={3} maxLength={64} value={editUsername} onChange={(event) => setEditUsername(event.target.value)} /></label>
      <label><span>{es ? "Correo (opcional)" : "Email (optional)"}</span><input type="email" value={editEmail} onChange={(event) => setEditEmail(event.target.value)} placeholder="name@example.com" /></label>
      <label><span>{es ? "Rol" : "Role"}</span><select value={editRole} onChange={(event) => setEditRole(event.target.value as ManagedUser["role"])} disabled={editUser.id === currentUserId}><option value="administrator">administrator</option><option value="operator">operator</option><option value="viewer">viewer</option></select></label>
      <label className="users-edit-password"><span><KeyRound size={14} />{es ? "Nueva contraseña (opcional)" : "New password (optional)"}</span><input type="password" autoComplete="new-password" minLength={passwordMinLength} value={editPassword} onChange={(event) => setEditPassword(event.target.value)} placeholder={es ? "Dejar en blanco para conservarla" : "Leave blank to keep current password"} />{passwordRequireStrong && editPassword ? <small>{es ? "Incluye mayúscula, minúscula, número y símbolo." : "Include uppercase, lowercase, a number, and a symbol."}</small> : null}</label>
      <label className="users-edit-enabled"><input type="checkbox" checked={editEnabled} onChange={(event) => setEditEnabled(event.target.checked)} disabled={editUser.id === currentUserId} /><span>{es ? "Cuenta activa" : "Account active"}</span></label>
      {editPassword && editUser.id === currentUserId ? <p className="users-session-note">{es ? "Al cambiar tu propia contraseña se cerrarán las sesiones y tendrás que iniciar sesión de nuevo." : "Changing your own password revokes sessions and requires you to sign in again."}</p> : null}
      <div className="modal-actions"><button type="button" onClick={() => setEditUser(null)} disabled={saving}><X size={15} />{es ? "Cancelar" : "Cancel"}</button><button className="primary-button" type="submit" disabled={saving || !editUsername.trim()}>{saving ? <LoaderCircle size={15} className="spinning" /> : <Check size={15} />}{saving ? (es ? "Guardando…" : "Saving…") : (es ? "Guardar cambios" : "Save changes")}</button></div>
    </form></section></div> : null}
    {deleting ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyId) setDeleting(null); }}><section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="users-delete-title"><span className="modal-kicker"><Trash2 size={15} />{es ? "Eliminar cuenta" : "Delete account"}</span><h2 id="users-delete-title">{es ? `¿Eliminar a ${deleting.username}?` : `Delete ${deleting.username}?`}</h2><p>{es ? "Se eliminarán sus sesiones activas y tokens API. Esta acción no se puede deshacer." : "Their active sessions and API tokens will be revoked. This action cannot be undone."}</p><div className="modal-actions"><button type="button" onClick={() => setDeleting(null)} disabled={Boolean(busyId)}><X size={15} />{es ? "Cancelar" : "Cancel"}</button><button type="button" className="danger-button" onClick={() => void removeUser()} disabled={Boolean(busyId)}><Trash2 size={15} />{busyId ? (es ? "Eliminando…" : "Deleting…") : (es ? "Eliminar usuario" : "Delete user")}</button></div></section></div> : null}
  </main>;
}
