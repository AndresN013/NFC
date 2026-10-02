import { describe, expect, it } from 'vitest';
import {
  SUPPORT_CASE_REASONS,
  SUPPORT_CASE_REASON_COPY,
  SUPPORT_CASE_STATES,
  SUPPORT_CASE_STATE_COPY,
  SUPPORT_CASE_TRANSITIONS,
  canTransitionSupportCase,
  assertChipTransition,
  canTransitionChip,
  CHIP_STATES,
  CHIP_TRANSITIONS,
  InvalidStateTransitionError,
  canTransitionJerseyUnit,
  canTransitionProductionOrder,
} from './states.js';

describe('maquina de estados del chip', () => {
  it('cubre todos los estados declarados', () => {
    for (const state of CHIP_STATES) {
      expect(CHIP_TRANSITIONS[state]).toBeDefined();
    }
  });

  it('recorre la ruta feliz completa de produccion', () => {
    const path = [
      'RECEIVED',
      'VALIDATED',
      'RESERVED',
      'PERSONALIZING',
      'PROGRAMMED',
      'VERIFIED',
      'LINKED',
      'READY_FOR_HEAT_PRESS',
      'POST_PRESS_PASSED',
      'ACTIVATED',
    ] as const;
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransitionChip(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it('impide saltarse la verificacion posterior a la escritura', () => {
    expect(canTransitionChip('PROGRAMMED', 'LINKED')).toBe(false);
  });

  it('impide activar sin pasar por el control posterior al termosellado', () => {
    expect(canTransitionChip('LINKED', 'ACTIVATED')).toBe(false);
    expect(canTransitionChip('READY_FOR_HEAT_PRESS', 'ACTIVATED')).toBe(false);
  });

  it('impide reprogramar un chip ya activado', () => {
    expect(canTransitionChip('ACTIVATED', 'PERSONALIZING')).toBe(false);
    expect(canTransitionChip('ACTIVATED', 'RESERVED')).toBe(false);
  });

  it('permite reintentar la escritura tras un fallo de comunicacion', () => {
    expect(canTransitionChip('PERSONALIZING', 'PERSONALIZING')).toBe(true);
    expect(canTransitionChip('PROGRAMMED', 'PERSONALIZING')).toBe(true);
  });

  it('permite poner en cuarentena desde cualquier estado operativo', () => {
    const operativos = CHIP_STATES.filter(
      (s) => s !== 'QUARANTINED' && s !== 'REVOKED' && s !== 'DESTROYED',
    );
    for (const state of operativos) {
      expect(canTransitionChip(state, 'QUARANTINED')).toBe(true);
    }
  });

  it('DESTROYED es terminal', () => {
    expect(CHIP_TRANSITIONS.DESTROYED).toHaveLength(0);
  });

  it('un chip revocado solo puede destruirse', () => {
    expect(CHIP_TRANSITIONS.REVOKED).toEqual(['DESTROYED']);
  });

  it('lanza un error tipado en transiciones invalidas', () => {
    expect(() => assertChipTransition('ACTIVATED', 'RECEIVED')).toThrow(
      InvalidStateTransitionError,
    );
  });
});

describe('maquina de estados de la unidad de jersey', () => {
  it('no permite resucitar una unidad revocada', () => {
    expect(canTransitionJerseyUnit('REVOKED', 'ACTIVATED')).toBe(false);
  });

  it('permite rehabilitar desde cuarentena', () => {
    expect(canTransitionJerseyUnit('QUARANTINED', 'ACTIVATED')).toBe(true);
  });
});

describe('maquina de estados de la orden de produccion', () => {
  it('no permite reabrir una orden completada', () => {
    expect(canTransitionProductionOrder('COMPLETED', 'IN_PROGRESS')).toBe(false);
  });

  it('permite pausar y reanudar', () => {
    expect(canTransitionProductionOrder('IN_PROGRESS', 'PAUSED')).toBe(true);
    expect(canTransitionProductionOrder('PAUSED', 'IN_PROGRESS')).toBe(true);
  });
});

describe('maquina de estados del caso de soporte', () => {
  it('cubre todos los estados declarados', () => {
    for (const state of SUPPORT_CASE_STATES) {
      expect(SUPPORT_CASE_TRANSITIONS[state]).toBeDefined();
    }
  });

  it('no permite reabrir un caso cerrado', () => {
    expect(SUPPORT_CASE_TRANSITIONS.CLOSED).toHaveLength(0);
    expect(canTransitionSupportCase('CLOSED', 'IN_PROGRESS')).toBe(false);
  });

  it('permite retomar un caso resuelto pero no uno cerrado', () => {
    expect(canTransitionSupportCase('RESOLVED', 'IN_PROGRESS')).toBe(true);
    expect(canTransitionSupportCase('CLOSED', 'RESOLVED')).toBe(false);
  });

  it('todo estado tiene texto en espanol', () => {
    for (const state of SUPPORT_CASE_STATES) {
      expect(SUPPORT_CASE_STATE_COPY[state].length).toBeGreaterThan(2);
    }
  });

  it('todo motivo tiene texto en espanol', () => {
    for (const reason of SUPPORT_CASE_REASONS) {
      expect(SUPPORT_CASE_REASON_COPY[reason].length).toBeGreaterThan(5);
    }
  });
});
