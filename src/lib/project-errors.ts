const spanish: Record<string, string> = {
  "Could not inspect Docker port assignments.": "No se pudieron consultar los puertos asignados en Docker.",
  "Could not inspect Compose port configuration.": "No se pudieron consultar los puertos configurados en Compose.",
  "Use a project name between 2 and 63 characters.": "Usa un nombre de proyecto de 2 a 63 caracteres.",
  "Description is too long.": "La descripción es demasiado larga.",
  "Project not found": "No se encontró el proyecto.",
  "Project service not found": "No se encontró el servicio del proyecto.",
  "Service details are invalid": "Los datos del servicio no son válidos.",
  "A target is required for imported services": "Selecciona el recurso que quieres importar.",
  "Git deployment source not found or unavailable": "La fuente de despliegue Git no existe o no está disponible.",
  "Docker container not found": "No se encontró el contenedor Docker.",
  "Compose project not found": "No se encontró el proyecto Compose.",
  "Project or service with this name already exists.": "Ya existe un proyecto o servicio con ese nombre.",
  "Could not save project": "No se pudo guardar el proyecto.",
  "Could not read the project service.": "No se pudo consultar el servicio del proyecto.",
  "Could not load project.": "No se pudo cargar el proyecto.",
  "Could not load projects.": "No se pudieron cargar los proyectos.",
  "Could not remove project link.": "No se pudo quitar la asociación del proyecto.",
  "Could not read logs": "No se pudieron leer los logs.",
  "Container not found": "No se encontró el contenedor.",
  "Authentication required": "Inicia sesión para continuar.",
  "This account cannot manage projects": "Esta cuenta no tiene permiso para administrar proyectos.",
  "This project still has services. Remove its services before deleting the project.": "El proyecto aún tiene servicios. Quítalos antes de eliminarlo.",
  "A project tag was not found": "No se encontró una de las etiquetas del proyecto.",
  "Use a tag name between 1 and 40 characters.": "Usa un nombre de etiqueta de 1 a 40 caracteres.",
  "A project tag with this name already exists.": "Ya existe una etiqueta con ese nombre.",
  "Project environment variable is invalid": "La variable del proyecto no es válida.",
  "Project environment variable not found": "No se encontró la variable del proyecto.",
  "Project environment references require a project context": "Las referencias del entorno requieren un proyecto asociado.",
  "Application details are invalid": "Revisa el nombre y la descripción de la aplicación.",
  "git_webhook_secret_required": "Guarda un secreto de webhook en la conexión Git antes de desactivar la consulta periódica.",
  "App name must use lowercase letters, numbers, and hyphens.": "El nombre de aplicación solo puede usar minúsculas, números y guiones.",
  "An application or app name with these values already exists in this project.": "Ya existe una aplicación con ese nombre en el proyecto.",
};

export function localizeProjectError(message: string, language: "es" | "en"): string {
  if (message === "git_webhook_secret_required") return language === "es"
    ? "Guarda un secreto de webhook en la conexión Git antes de desactivar la consulta periódica."
    : "Save a webhook secret in the Git connection before disabling polling.";
  if (/^(failed to fetch|networkerror when attempting to fetch resource|load failed)$/i.test(message.trim())) {
    return language === "es"
      ? "No se pudo conectar con Vessel. Comprueba la conexión e inténtalo de nuevo."
      : "Vessel could not be reached. Check the connection and try again.";
  }
  if (language !== "es") return message;
  const portConflict = message.match(/^Host port (.+) is already used by container (.+)\.$/);
  if (portConflict) return `El puerto ${portConflict[1]} ya está ocupado por el contenedor ${portConflict[2]}. Cambia el puerto publicado en Compose o en sus variables.`;
  const missingPort = message.match(/^Container (.+) did not publish port (.+) \((.+)\)\.$/);
  if (missingPort) return `El contenedor ${missingPort[1]} no publicó el puerto ${missingPort[2]} (${missingPort[3]}). Revisa la red antes de volver a desplegar.`;
  const missingBindings = message.match(/^Service (.+) is missing its configured port bindings\.$/);
  if (missingBindings) return `El servicio ${missingBindings[1]} no tiene los puertos configurados en Compose.`;
  const missingVariable = message.match(/^Project environment variable ([A-Za-z_][A-Za-z0-9_]*) is not configured$/);
  if (missingVariable) return `La variable ${missingVariable[1]} no está configurada en el entorno del proyecto.`;
  return spanish[message] ?? message;
}
