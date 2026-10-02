'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { uiStyles } from './ui';

/**
 * Dialogo modal sobre el elemento nativo `<dialog>`.
 *
 * Se usa el elemento nativo a proposito: el navegador ya se encarga del foco
 * atrapado dentro del dialogo, de cerrar con Escape y de marcar el resto de la
 * pagina como inerte. Reimplementar eso a mano es la fuente habitual de modales
 * inaccesibles.
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
}): React.ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = `dialogo-${title.replace(/\s+/g, '-').toLowerCase()}`;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={uiStyles.dialogo}
      aria-labelledby={titleId}
      // Escape emite `cancel`; se avisa al padre para que sincronice su estado.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>
  );
}

export function DialogActions({ children }: { children: ReactNode }): React.ReactElement {
  return <div className={uiStyles.dialogoAcciones}>{children}</div>;
}
