# Asphalt Rivals — QA de la escena 3D seca

## Objetivo vigente

Las instrucciones posteriores del usuario sustituyen la lluvia y el catálogo anterior:

- Una sola moto AR-01: misma geometría para jugador y rival, roja y azul respectivamente.
- Solo dos tipos de tráfico: sedán y furgoneta, con distintos colores.
- Cielo nublado, sin lluvia; asfalto seco.
- Moto, piloto y vehículos tridimensionales, no fotografías recortadas.

La imagen `docs/references/expected-aaa.png` es una referencia histórica de composición/calidad, no una obligación de mantener lluvia, suelo mojado o tres clases de vehículos. `docs/references/current-build.png` tampoco representa la versión actual.

## Evidencia visual

- Referencia histórica: 1672 × 941 px.
- Captura anterior: 1888 × 909 px; distinto encuadre y estado.
- Captura actual: no disponible.
- Viewport previsto para la siguiente revisión: 1672 × 941 CSS px, DPR 1.
- Estado previsto: carrera exterior con rival cercano, ambos tipos de tráfico y un adelantamiento; segunda captura dentro del túnel.
- Comparación conjunta de referencia y versión actual: bloqueada.
- Regiones pendientes: cockpit/manos, moto completa en ambos colores, cristales/ruedas de tráfico, carretera/cielo y HUD.

El navegador integrado vuelve a fallar al iniciar por el helper de sandbox de Windows. Se solicitó autorización para una captura local headless; no se ha utilizado esa alternativa sin respuesta del usuario.

No se ha ejecutado una comparación ciega reproducible de esta versión. No se atribuyen puntuaciones ni porcentajes de preferencia al resultado.

## Cambios implementados

- `models/motorcycle.ts` ensambla el mismo chasis y cockpit para las dos motos; no hay una moto diferente de primera persona.
- La cámara se coloca en la moto local. Solo se oculta su cuerpo de piloto en primera persona para evitar que el casco y torso obstruyan la cámara.
- `roadVehicles.ts` contiene únicamente sedán y furgoneta. Un tipo antiguo truck se representa como furgoneta por compatibilidad; las carreras nuevas ya no generan trucks.
- Ventanas conformadas al exterior de las carrocerías; profundidad normal, sin trucos de renderizado.
- Pool de tráfico con identidad estable, ruedas independientes y dimensiones de carrocería alineadas con la simulación. Los espejos no amplían el collider.
- Cielo cubierto procedural, iluminación difusa, niebla ligera y asfalto mate de grano fino.
- Retirados lluvia, spray, charcos, reflejos de suelo mojado y fondos/vehículos fotográficos activos.
- Los PNG anteriores se conservaron fuera de la carpeta pública, en `docs/references/archived-photo-prototype/`.
- Contacto de neumáticos en y=0 y marcas viales a 0.5 mm sobre la carretera.
- Márgenes de colisión reducidos de 5.6 m longitudinales/0.55 m laterales a 0.08 m/0.03 m; pruebas de contacto y adelantamiento añadidas.

## Revisión independiente

El agente `dry_scene_audit` revisó las correcciones técnicas y no detectó un P0/P1 nuevo que impida compilar.

Comprobación geométrica de ambas motos: 107 meshes y 25 058 triángulos, mismos límites espaciales y modelo, distintos colores. Esto demuestra identidad geométrica, no calidad visual.

Pruebas añadidas en `models/models.test.ts`: igualdad de posiciones de vértices y transformaciones, ausencia de sprites, dos diseños de tráfico, coordenadas finitas, ruedas independientes y materiales de asfalto seco. La simulación incluye regresiones para dos tipos e impactos sin contacto anticipado.

## Superficies de fidelidad

- Tipografía: interfaz existente conservada; lectura del instrumento y HUD pendiente de captura.
- Espaciado/encuadre: posición de cámara/tablero comprobada geométricamente; proporciones visuales y móvil pendientes.
- Color: pinturas roja/azul y luz gris de cielo cubierto implementadas; exposición en pantalla pendiente.
- Imágenes/geometría: fotos retiradas de la escena. Misma moto y dos tipos de vehículos verificados en datos; aspecto y rendimiento reales pendientes.
- Texto: HUD y lobby indican NUBLADO, ASFALTO SECO y SIN LLUVIA; no se muestra el antiguo porcentaje fijo de tracción.

## Pendientes

Verificación técnica final: `pnpm check` pasó (40 tests, tipos, lint y formato) y `pnpm build` pasó. Vite mantiene una advertencia de bundle JavaScript mayor de 500 kB; no es una comprobación de FPS.

- [P1] Captura y prueba real de conducción: apariencia, transparencias, oclusión, contacto, cambios de iluminación y errores de consola.
- [P2] Medir FPS en exterior/túnel; perfilar los 107 meshes por moto y la actualización de las pantallas antes de optimizar.
- [P2] Comprobar encuadre y controles a anchos móvil y escritorio.

Las pruebas de tipos, geometría y simulación no sustituyen una captura ni una revisión visual. No hay aprobación AAA.

final result: blocked
