# Render Blueprint — Filo Atlántico

## Norte visual

Una autopista atlántica al anochecer, recién mojada por una tormenta. El mundo combina ingeniería de competición, roca volcánica, vegetación barrida por el viento y señalética española. La imagen se apoya en negro asfalto, azul petróleo y luz ámbar; el cian queda reservado para navegación y el coral para peligro y velocidad.

La prioridad es que cada fotograma comunique velocidad sin ocultar la carretera. Los efectos nunca deben competir con las siluetas de motos, vehículos ni límites de carril.

## Pipeline

- `WebGLRenderer` como ruta estable; WebGPU solo después de lograr paridad funcional y visual.
- Espacio de trabajo Linear-sRGB, salida sRGB, tone mapping ACES y exposición calibrada por escena.
- Iluminación física con sol direccional, cielo/HDRI prefiltrado y luces locales limitadas.
- PBR glTF 2.0 con texturas KTX2, geometría Meshopt/Draco y convenciones consistentes de escala.
- Postprocesado por calidad: antialiasing, GTAO/SSAO, bloom selectivo, LUT, niebla, viñeta y aberración cromática apenas perceptible.
- Motion blur direccional dependiente de velocidad; nunca aplicado al HUD.

## Presupuestos por calidad

| Perfil | Resolución dinámica | Sombras | Post FX | Objetivo |
| --- | --- | --- | --- | --- |
| Alto | 0.85–1.0 DPR efectivo | 2048, cascadas | Completo | 60 fps a 1080p en GPU dedicada media |
| Medio | 0.7–0.9 | 1024, una cascada | Sin GTAO costoso | 60 fps en portátil moderno |
| Bajo | 0.55–0.8 | Contacto simplificado | AA + LUT | 30–60 fps, estabilidad prioritaria |

El runtime reduce primero efectos, luego sombras y finalmente resolución. Nunca reduce la frecuencia fija de simulación.

## Escena y assets

- Tramos de carretera modulares reciclados alrededor del jugador; origen flotante para evitar pérdida de precisión.
- Tráfico, guardarraíles, postes y vegetación con instancing y object pools sin asignaciones por frame.
- Motos con LOD de carrocería, ruedas separadas, horquilla animada, piloto con esqueleto e inclinación secundaria.
- Materiales de asfalto con variación macro, charcos en máscaras y normales que no repitan patrón visible.
- Audio por capas de RPM, carga, transmisión, viento y superficie, más mezcla dinámica en adelantamientos.

## Cámaras

- Cámara principal en primera persona con FOV base conservador y expansión suave por velocidad.
- Vibración basada en suspensión/RPM con límites de confort; sin ruido aleatorio en HUD.
- Cámara de repetición desacoplada de la simulación para capturas deterministas.
- Pantalla dividida renderizada desde una sola escena y un solo conjunto de recursos GPU.

## Puertas de calidad

1. Capturas deterministas con seed, cámara, exposición y resolución fijas.
2. Revisión separada de iluminación, materiales, composición, movimiento, HUD y rendimiento.
3. A/B con etiquetas aleatorias frente a referencias legales equivalentes; aprobar con puntuación media mínima de 4/5 y cero defectos críticos.
4. Perf capture sin crecimiento sostenido de memoria, errores WebGL ni stutters de compilación tras el calentamiento.
5. Contraste y legibilidad del HUD verificados en movimiento, daltonismo simulado y perfiles de calidad alto/bajo.

