# Procedimiento de Atencion — SLA Operaciones de Campo

## Responsable
**Roman** — Operaciones de Campo

## Objetivo
Este documento define los tiempos maximos (SLA) que Roman debe cumplir en cada fase de atencion de un ticket de soporte. Los tiempos son configurados en `config/sla.yaml` y se reflejan automaticamente en el tablero TV.

## Fases del Proceso

### 1. Responder al usuario
- **Tiempo maximo**: 5 minutos
- **Disparador**: Se asigna un ticket nuevo al equipo
- **Que hacer**: Confirmar recepcion del ticket, responder al usuario indicando que su solicitud fue recibida
- **Indicador en tablero**: Timer visible desde la creacion del ticket

### 2. Recuperar usuario
- **Tiempo maximo**: 10 minutos (desde creacion)
- **Disparador**: Si el usuario no responde o se necesita mas informacion
- **Que hacer**: Contactar al usuario por los canales disponibles para obtener la informacion necesaria
- **Nota**: Este SLA corre en paralelo con "Responder al usuario"

### 3. Avisar al equipo
- **Tiempo maximo**: 10 minutos (desde creacion) — solo para tickets Urgentes (prioridad 1)
- **Disparador**: Ticket urgente reportado que Roman no puede resolver solo
- **Que hacer**: Informar al equipo sobre el ticket reportado, escalar si es necesario

### 4. Iniciar resolucion
- **Tiempo maximo**: 10 minutos
- **Disparador**: Roman confirma que puede resolver el ticket
- **Que hacer**: Cambiar el estado del ticket a "En progreso", comenzar el trabajo de resolucion

### 5. Respuesta definitiva
- **Tiempo maximo**: 30 minutos
- **Disparador**: Resolucion completada
- **Que hacer**: Proporcionar respuesta definitiva al usuario, documentar la solucion en el ticket, cerrar el ticket

## Flujo de trabajo

```
Ticket asignado
    |
    +-- (0-5 min) --> Responder al usuario
    |
    +-- (0-10 min) --> Recuperar informacion del usuario (si aplica)
    |
    +-- (0-10 min) --> Avisar al equipo (solo urgente, si no puede resolver)
    |
    +-- (0-10 min) --> Iniciar resolucion
    |
    +-- (0-30 min) --> Respuesta definitiva
```

## Evaluacion Semanal (Viernes)

Cada viernes se evalua la productividad de Operaciones de Campo mediante el Friday Report del tablero. Las metricas consideradas son:

- **Tickets resueltos** en la ultima semana
- **Cumplimiento SLA** — porcentaje de tickets resueltos dentro del tiempo limite
- **Tiempo promedio de resolucion**
- **Rendimiento por miembro del equipo**

## Visualizacion en Tablero

El tablero TV muestra:
- Tickets agrupados por prioridad (Urgente, Alta, Media, Baja, Sin prioridad)
- Temporizadores visuales de SLA en formato circular con cuenta regresiva
  - **Verde**: dentro del tiempo
  - **Amarillo**: proximo a vencer (menos del 20% del tiempo restante)
  - **Rojo**: tiempo excedido
- Asignado a ("Chef") que esta cocinando el ticket
- Labels del ticket desde Linear
- Multiples fases de SLA visibles por ticket

## Configuracion

Los SLAs se configuran en `config/sla.yaml`. El tablero se actualiza automaticamente al guardar cambios gracias a la recarga en caliente (hot-reload).

Ejemplo de configuracion:
```yaml
slas:
  - id: responder_usuario
    label: "Responder al usuario"
    applicablePriorities: [1, 2]
    maxMinutes: 5
    warningThreshold: 0.2
```

## Notas

- Los tiempos comienzan desde el momento de creacion del ticket en Linear
- El tablero se actualiza en tiempo real via Server-Sent Events (SSE)
- Los sonidos de alerta se activan cuando un ticket nuevo urgente llega o un SLA se vence
- Todo el tablero es configurable desde archivos YAML en `config/`
