'use client';

import { useState } from 'react';
import { CHIP_STATES } from '@mev/domain/browser';
import { useApiQuery } from '@/hooks/useApiQuery';
import { GuardedPage } from '@/components/GuardedPage';
import { DataTable, Mono, type Column } from '@/components/DataTable';
import {
  Button,
  Callout,
  FilterBar,
  PageHeader,
  Pagination,
  SelectFilter,
  StateTag,
} from '@/components/ui';
import { describeChipState, formatDateTime, orDash } from '@/lib/format';
import type { ChipRow, Paged } from '@/lib/types';

const PAGE_SIZE = 25;

export default function ChipsPage(): React.ReactElement {
  return (
    <GuardedPage permissions={['chips:read']}>
      <Chips />
    </GuardedPage>
  );
}

function Chips(): React.ReactElement {
  const [page, setPage] = useState(1);
  const [state, setState] = useState('');

  const { data, error, loading, reload } = useApiQuery<Paged<ChipRow>>('/admin/chips', {
    page,
    pageSize: PAGE_SIZE,
    state,
  });

  const columns: Column<ChipRow>[] = [
    {
      key: 'uid',
      header: 'UID del chip',
      rowHeader: true,
      render: (row) => <Mono>{row.uid}</Mono>,
    },
    { key: 'type', header: 'Tipo', render: (row) => row.chipType },
    {
      key: 'state',
      header: 'Estado',
      render: (row) => <StateTag descriptor={describeChipState(row.state)} />,
    },
    {
      key: 'batch',
      header: 'Lote',
      render: (row) => (
        <>
          {row.batch ? <Mono>{row.batch}</Mono> : '—'}
          {/* La marca de calidad va en texto, no sólo en color. */}
          {row.batchFlagged ? (
            <>
              <br />
              <StateTag descriptor={{ label: 'Lote marcado', symbol: '⚠', tone: 'aviso' }} />
            </>
          ) : null}
        </>
      ),
    },
    {
      key: 'counter',
      header: 'Último contador',
      numeric: true,
      render: (row) => orDash(row.lastAcceptedCounter),
    },
    { key: 'programmedAt', header: 'Programado', render: (row) => formatDateTime(row.programmedAt) },
    { key: 'activatedAt', header: 'Activado', render: (row) => formatDateTime(row.activatedAt) },
  ];

  return (
    <>
      <PageHeader
        title="Chips NFC"
        description="Inventario de chips con su estado en la cadena de producción."
      />

      {/*
        Aviso obligatorio de la pagina: el UID identifica físicamente un chip y
        permite correlacionar lecturas. Se muestra completo porque `chips:read`
        lo autoriza, pero quien lo ve debe saber lo que tiene delante.
      */}
      <Callout variant="peligro" title="El UID del chip es un dato sensible">
        <p>
          Esta pantalla muestra el <strong>UID completo</strong> de cada chip. Un UID identifica de
          forma única una pieza física y permite correlacionar sus lecturas, así que no debe
          copiarse a hojas de cálculo, mensajes ni tickets de soporte, ni compartirse con
          proveedores o patrocinadores.
        </p>
        <p>
          El acceso a esta página queda registrado en auditoría. El hash del token del chip nunca se
          expone, ni siquiera a un superadministrador.
        </p>
      </Callout>

      <FilterBar>
        <SelectFilter
          label="Estado del chip"
          value={state}
          onChange={(value) => {
            setState(value);
            setPage(1);
          }}
          allLabel="Todos los estados"
          options={CHIP_STATES.map((value) => ({ value, label: describeChipState(value).label }))}
        />
        {state ? (
          <Button
            variant="discreto"
            onClick={() => {
              setState('');
              setPage(1);
            }}
          >
            Quitar filtro
          </Button>
        ) : null}
      </FilterBar>

      <DataTable
        caption="Chips NFC del inventario"
        captionDetail="Contiene UID completos: dato sensible."
        columns={columns}
        rows={data?.items ?? null}
        getRowKey={(row) => row.id}
        loading={loading}
        error={error}
        onRetry={reload}
        emptyMessage={
          state ? 'Ningún chip en ese estado.' : 'No hay chips registrados en el inventario.'
        }
      />

      {data ? (
        <Pagination
          total={data.total}
          page={data.page}
          pageSize={data.pageSize}
          onPageChange={setPage}
        />
      ) : null}
    </>
  );
}
