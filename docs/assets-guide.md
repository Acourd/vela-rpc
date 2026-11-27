# Guía Forense de Assets & Identidad Visual — Acourd RPC

Esta guía documenta la investigación forense (`/scout`), especificación técnica de activos y funcionamiento real de los iconos en **Discord Rich Presence (RPC)** para Google Antigravity y Claude Code.

---

## 1. ¿Cómo resuelve Discord los Iconos en Rich Presence?

A diferencia de la web donde se pueden usar URLs arbitrarias o SVGs en línea, Discord Desktop utiliza un sistema cerrado de resolución de activos:

1. **Protocolo IPC Local:** El cliente de Acourd transmite un paquete binario con el payload JSON conteniendo claves de texto (`asset_key`):
   ```json
   {
     "assets": {
       "large_image": "antigravity_logo",
       "large_text": "Google Antigravity 2.0",
       "small_image": "thinking",
       "small_text": "Reasoning & Planning"
     }
   }
   ```
2. **Resolución en CDN de Discord:** La aplicación de escritorio de Discord toma la clave y la busca en sus servidores:
   - **Vía Art Assets de Rich Presence:**  
     `https://cdn.discordapp.com/app-assets/<application_id>/<asset_key>.png`
   - **Vía Avatar de Aplicación (Fallback):**  
     `https://cdn.discordapp.com/app-icons/<application_id>/<icon_hash>.png`
3. **Restricción Clave:** Discord **no** descarga imágenes de servidores externos no autorizados ni admite imágenes en base64 en el socket IPC. Todo icono mostrado en Discord debe estar registrado en el [Discord Developer Portal](https://discord.com/developers/applications) bajo el `application_id` activo.

---

## 2. Investigación Forense de la Competencia (/scout)

| Proyecto Auditado | Client ID en Discord | Manejo de Iconos | Fuente del Icono |
| :--- | :--- | :--- | :--- |
| **`claude-code-discord-status`** (Bruno Jurkovic) | `1472915568930848829` | Registró 9 Art Assets en Developer Portal (`claude-code`, `thinking`, `coding`, `terminal`, `reading`, `searching`, `starting`, `idle`, `multi-session`). | Emblema oficial terracota de Anthropic con badges de estado circulares. |
| **`antigravity-rpc`** (A-Gift-Of-Flame) | `1440730997460172810` | Registró la aplicación `antigravity` con el avatar oficial, pero omitió subir las claves a la pestaña *Rich Presence Assets*. | El arnés/arco oficial extraído del instalador de Antigravity (`faa4a2559730901e6156627c96a760e6`). |
| **`vscord`** (LeonardSSH) | Múltiples IDs dedicados | Registró más de 150 Art Assets con logos oficiales de lenguajes y frameworks. | Simple Icons y kits oficiales de desarrollo. |

---

## 3. Activos Canónicos Oficiales Incluidos en Acourd

En el directorio `assets/` se incluyen los archivos PNG transparentes de alta resolución (512×512 px) extraídos de fuentes oficiales primarias:

- **`assets/antigravity_logo.png`**: Extraído directamente del paquete de producción de Antigravity (`app.asar/icon.png`). Corresponde al **arco parabólico ("arnés")** con el gradiente característico de Google AI / Gemini (verde lima y rojo naranja en la cúspide, descendiendo hacia azul eléctrico en los apoyos).
- **`assets/claude_logo.png`**: Extraído de los activos canónicos de Anthropic. Corresponde a la chispa/estrella de puntas redondeadas sobre fondo terracota (`#D97757`).

---

## 4. Configuración en Discord Developer Portal (Paso a Paso)

Si deseas crear tu propia presencia personalizada o modificar el nombre que Discord muestra como "Jugando a ...":

1. Ve a [Discord Developer Portal](https://discord.com/developers/applications) e inicia sesión.
2. Pulsa en **"New Application"** y ponle el nombre exacto que quieres que aparezca (ej: `Google Antigravity 2.0` o `Claude Code`).
3. En la sección **General Information**, sube `assets/antigravity_logo.png` o `assets/claude_logo.png` en el campo **App Icon**.
4. Ve a la barra lateral izquierda ➔ **Rich Presence** ➔ **Art Assets**.
5. Pulsa en **"Add Image(s)"** y sube:
   - `antigravity_logo.png` con la clave `antigravity_logo`
   - `claude_logo.png` con la clave `claude_code`
   - Los badges de estados (`thinking`, `tool_call`, `verifying`, `swarm`, `idle`)
6. Copia el **Application ID** de tu nueva aplicación e indícaselo a Acourd en la variable de entorno:
   ```bash
   acourd set --client-id <TU_APPLICATION_ID>
   ```
