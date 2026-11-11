<p align="center">
  <img src="public/favicon.svg" alt="Logo de Vessel" width="92" height="92">
</p>

<h1 align="center">Vessel</h1>

<p align="center"><strong>Un solo plano de control para Docker, Compose y despliegues.</strong></p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.es.md"><strong>Español</strong></a>
</p>

<p align="center">
  <img alt="Go" src="https://img.shields.io/badge/Go-plano%20de%20control-00ADD8?logo=go&logoColor=white">
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-consola%20web-111111?logo=nextdotjs&logoColor=white">
  <img alt="Docker" src="https://img.shields.io/badge/Docker-Engine%20%2B%20Compose-2496ED?logo=docker&logoColor=white">
  <img alt="SQLite" src="https://img.shields.io/badge/SQLite-metadatos%20locales-003B57?logo=sqlite&logoColor=white">
</p>

<p align="center">
  Vessel es una plataforma autoalojada y de propósito general para inspeccionar y operar recursos Docker, gestionar proyectos Compose y desplegar aplicaciones desde Git.
</p>

---

## Qué es Vessel

Vessel reúne operaciones comunes de contenedores y entrega de aplicaciones en un solo plano de control web. Busca que el trabajo diario con Docker sea claro para desarrolladores y operadores, sin depender de un catálogo fijo de servicios ni de un ERP, motor de base de datos o proveedor cloud específico.

Vessel es un proyecto independiente: usa conceptos familiares de infraestructura, pero no es un fork ni una réplica visual de Portainer o Dokploy.

### Funcionalidades disponibles

- **Recursos Docker:** inspección de contenedores, inicio, detención, reinicio, recreación, eliminación y logs; gestión de imágenes, volúmenes y redes.
- **Proyectos Compose:** detección mediante etiquetas Docker, edición de archivos montados, validación con `docker compose config` y despliegue o detención de proyectos.
- **Despliegues Git:** conexión con proveedores Git, selección de repositorios accesibles, configuración de rama, archivo Compose y variables; seguimiento del progreso e historial. GitHub usa una GitHub App instalable; GitLab, Gitea y Bitbucket usan los flujos de credenciales/OAuth de cada proveedor.
- **Duplicación con datos:** duplicación de una aplicación sola o copia de su base de datos como un recurso separado. Los adaptadores iniciales copian PostgreSQL, MySQL y MariaDB cuando Vessel identifica una conexión completa en el servicio de origen.
- **Tareas programadas:** ejecuta scripts de shell confiables manualmente o con cron, con zona horaria, variables de entorno cifradas, límite de ejecución, historial persistente y salida registrada.
- **Acceso y secretos:** creación inicial del administrador, roles administrador/operador/lector, sesiones con expiración y revocación, y credenciales de registries/proveedores/despliegues cifradas en SQLite.
- **Vista del host:** información de Docker/Compose y métricas de CPU, memoria y del sistema de archivos que contiene los datos de Vessel.
- **Inglés y español:** cambia el idioma desde el encabezado de la aplicación.

## Roadmap del producto

Este roadmap documenta la dirección del producto, no fechas de entrega. Separa lo que ya se puede usar de lo que conviene construir después; las prioridades pueden cambiar con el uso real.

### 1. Un espacio confiable para Docker — disponible, con mejoras continuas

- Mantener contenedores, imágenes, volúmenes, redes y proyectos Compose en espacios diferenciados, con búsqueda, ordenamiento, acciones y confirmaciones coherentes.
- Hacer visibles las operaciones: mostrar progreso, resultado final, logs útiles y errores recuperables sin bloquear recursos que no están involucrados.
- Seguir mejorando el resumen con capacidad del host, versiones de Docker Engine y Compose, totales de recursos e indicadores claros de estado/salud.
- Mantener el modelo genérico: nombres, etiquetas, redes, variables y montajes Docker deben funcionar sin supuestos de ADempiere.

### 2. Entrega de aplicaciones basada en Compose — disponible, en expansión

- Crear, validar, desplegar, actualizar y detener proyectos Compose desde Vessel.
- Detectar proyectos externos y editarlos cuando su directorio de origen esté montado explícitamente.
- Mejorar la revisión de despliegues con diferencias más claras, resultados de validación, historial y manejo seguro de archivos de entorno y secretos.
- Hacer evidentes las relaciones entre proyectos y contenedores, sin quitar el acceso a las operaciones directas de contenedor.

### 3. Despliegues conectados a Git — disponible, flujos en evolución

- Usar la instalación de una GitHub App para crear/conectar la aplicación desde GitHub y conceder acceso a todos o solo a algunos repositorios.
- Soportar GitLab, Bitbucket y Gitea mediante los modelos de aplicación y autorización propios de cada proveedor.
- Desplegar una rama y un archivo Compose seleccionados; mantener las credenciales del proveedor y los secretos por despliegue cifrados y fuera de las respuestas del navegador.
- Avanzar hacia estado de despliegue compartido en tiempo real, progreso persistente tras recargar o iniciar sesión de nuevo, mejores logs, reintentos y opciones seguras de rollback.
- Mantener el sondeo como alternativa sencilla para instalaciones locales; añadir webhooks solo cuando exista un endpoint seguro y accesible.

### 4. Clonación genérica de aplicación y datos — adaptadores iniciales disponibles, ampliar después

La meta distintiva es clonar una aplicación y, opcionalmente, el servicio de datos del que depende; no solo duplicar un contenedor. Vessel ya cuenta con adaptadores iniciales para PostgreSQL, MySQL y MariaDB, pero todavía no es un copiador universal de bases de datos.

- Separar claramente los flujos: **solo aplicación**, **aplicación + datos** y, más adelante, **respaldo/restauración de datos**.
- Ampliar el modelo de adaptadores para que la lógica de cada motor no contamine la interfaz genérica.
- Añadir motores de datos solo con verificaciones de capacidad, manejo de credenciales, progreso y restauraciones probadas.
- Reforzar protecciones para destinos existentes, nombres/puertos ocupados, orígenes de producción, volúmenes compartidos y sobrescrituras accidentales.
- Persistir estado y logs de la operación para que una recarga no oculte una copia larga; hacer explícitos los reintentos y la limpieza.

### 5. Scripts programados y respaldos — scripts disponibles, respaldos planificados

Vessel incluye un ejecutor integrado para scripts de shell confiables. El módulo **Tareas programadas** admite ejecución manual y expresiones cron, zonas horarias IANA, variables de entorno cifradas, límites de ejecución, historial persistente y logs capturados.

- Añadir cancelación, reintentos, referencias más completas a secretos y permisos más detallados.
- Añadir respaldos programados de bases de datos y volúmenes, políticas de retención, restauración y progreso compartido para operaciones largas.
- Seguir reforzando el aislamiento de scripts y aclarar los permisos antes de que una tarea pueda afectar datos de producción.

Esta capacidad aún es futura; la página actual de Trabajos no reemplaza un Rundeck de propósito general.

### 6. Varios hosts Docker y API de automatización estable — planificado

- Pasar de la conexión actual con el Docker Engine local a varios entornos con nombre, estado por host y recursos claramente delimitados.
- Evaluar un diseño de agentes/endpoints con privilegio mínimo, enrolamiento seguro, TLS y autorización por entorno antes de habilitar control Docker remoto.
- Documentar y versionar una API compatible con automatización, con credenciales de alcance limitado, auditoría, límites de uso y revocación.

## Arquitectura

Vessel se distribuye en un contenedor con dos procesos coordinados:

```text
Navegador
  └── Interfaz y API web Next.js / React
        └── plano de control Go interno (127.0.0.1:9100)
              └── API Docker Engine por /var/run/docker.sock

SQLite ── usuarios, sesiones, configuración, credenciales cifradas y metadatos operativos
```

El plano Go forma parte de Vessel; no es otro servicio de administración que haya que desplegar por separado. Las rutas Next.js actúan como adaptadores HTTP; la lógica de dominio y proveedores vive organizada en `src/server/api` y `src/lib`. SQLite conserva metadatos de la aplicación y Docker es la fuente de verdad de los recursos Docker.

## Inicio rápido

Requisitos: Docker Engine con el plugin Compose y permisos para acceder al socket Docker.

```bash
git clone https://github.com/jesusalbujas/vessel.git
cd vessel
cp .env.example .env
```

Antes de exponer Vessel, reemplaza los valores de ejemplo en `.env`:

- Asigna a `VESSEL_SECRET_KEY` un valor aleatorio privado de al menos 32 caracteres. Por ejemplo, genéralo con `openssl rand -hex 32` y pega el resultado en `.env`.
- Configura una contraseña segura en `VESSEL_ADMIN_PASSWORD`, o utiliza la pantalla de creación del primer administrador si no configuraste credenciales de bootstrap.
- Deja `VESSEL_COOKIE_SECURE` vacío si usas HTTPS. Solo en una red HTTP confiable y restringida, configúralo como `false`: Vessel seguirá en modo producción, pero el navegador enviará la cookie de sesión por HTTP.
- Mantén `.env` privado y respaldado de forma segura. Si pierdes o cambias la clave, los valores cifrados que Vessel ya guardó no podrán recuperarse.

Inicia Vessel:

```bash
docker compose up -d --build
```

Abre [http://127.0.0.1:55300](http://127.0.0.1:55300). Vessel guarda sus metadatos locales en `./data` y accede al Docker Engine local mediante `/var/run/docker.sock`.

El puerto web se enlaza a `127.0.0.1` de forma predeterminada. Para publicar Vessel detrás de un proxy inverso HTTPS confiable, configura `VESSEL_BIND_ADDRESS=0.0.0.0` y limita el puerto del host en el firewall para que solo sea accesible a través de ese proxy. El socket Docker otorga control del host; concede acceso a Vessel solo en equipos y a administradores de confianza.

### Imagen Docker y versiones etiquetadas

El Dockerfile mantenido está en `docker/Dockerfile`; también se incluye `docker/compose.yaml` para desplegar Vessel con un Compose autocontenido. Los Compose de la raíz utilizan el mismo Dockerfile.

Para publicar en Docker Hub, agrega los secretos de Actions `DOCKERHUB_USERNAME` (debe ser `jalbujas`) y `DOCKERHUB_TOKEN` (un token de Docker Hub con permiso para publicar) al repositorio. Luego sube un tag de versión, por ejemplo `v0.1.0`. El flujo `publish.yaml` compila `docker.io/jalbujas/vessel` para `linux/amd64` y `linux/arm64` y publica el tag de versión, los tags semánticos y `latest`. Cuando la publicación de la imagen termina correctamente, el mismo flujo crea un GitHub Release con notas generadas. La versión mostrada en Vessel se compila desde ese tag. `ci.yaml` verifica los tipos y compila en los pushes y pull requests dirigidos a `main` o `master`.

Para compilar con el Compose del directorio Docker, ejecuta `docker compose -f docker/compose.yaml up -d --build` desde la raíz del repositorio. Configura `VESSEL_VERSION` en `.env` solo si quieres que una compilación local muestre una versión distinta a la de `package.json`.

### Desarrollo con recarga en caliente

```bash
docker compose -f docker-compose.dev.yml up --build
```

El Compose de desarrollo monta el código y ejecuta `next dev`; los cambios normales de interfaz/API no requieren reconstruir el contenedor. Abre [http://127.0.0.1:55300](http://127.0.0.1:55300). Detén el entorno con `Ctrl+C` o `docker compose -f docker-compose.dev.yml down`.

### Archivos Compose existentes

Vessel puede detectar proyectos Compose externos mediante etiquetas Docker. Para leer y editar sus archivos, configura `VESSEL_COMPOSE_HOST_ROOT` con la ruta del host que contiene esos archivos antes de iniciar Vessel. Solo ese directorio configurado se monta para acceder a los archivos fuente.

### URL de retorno del proveedor Git

Vessel usa el origen visible en el navegador para las URL de retorno de proveedores Git, incluso direcciones HTTP como `http://192.168.1.20:55300`. Configura `VESSEL_PUBLIC_URL` solo si el proxy inverso o la dirección externa difiere de la URL que abren los usuarios. Se recomienda HTTPS fuera de redes locales confiables porque HTTP no cifra las sesiones ni los códigos de retorno.

## Notas de seguridad

Montar `/var/run/docker.sock` le da a Vessel un control amplio sobre Docker Engine; debe tratarse como acceso de administrador del host. No expongas Vessel directamente a internet: utiliza HTTPS, un proxy inverso confiable, restricciones de red, credenciales robustas y respaldos actualizados.

Vessel aplica hash `scrypt` a contraseñas locales, utiliza sesiones con expiración y cifra credenciales guardadas de proveedores/registries/despliegues con AES-256-GCM mediante `VESSEL_SECRET_KEY`. Aun así, quien controle Docker puede inspeccionar la configuración y las variables de entorno de los contenedores. Para valores sensibles en tiempo de ejecución, prefiere Docker Compose secrets o archivos montados; despliega únicamente repositorios confiables porque un proyecto Compose puede controlar el Docker Engine conectado.

## Límites actuales

- El plano de control administra el Docker Engine local; la gestión multi-host está en el roadmap.
- La copia de bases de datos se limita a los adaptadores iniciales PostgreSQL, MySQL y MariaDB y a configuraciones de conexión reconocidas.
- La duplicación normal de contenedores puede reutilizar volúmenes montados; no copia automáticamente los archivos persistentes que contienen. Revisa los montajes antes de duplicar.
- Los scripts de shell programados están disponibles para administradores; los flujos de respaldo, una auditoría amplia y una API pública de automatización siguen en el roadmap.

## Contribuir

Se agradecen issues y pull requests. Mantén el comportamiento específico de Docker/proveedores detrás de su adaptador, deja delgadas las rutas y añade textos en inglés y español para cada mensaje visible nuevo. Nunca subas archivos `.env`, claves privadas, tokens de acceso ni datos de producción.
