"use client";

import { useCallback, useEffect, useState } from "react";

import { ErrorText, PageHeader, controlClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui";
import { apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { CatalogItem, WorkflowRecord } from "@/lib/types";

export default function WorkflowsPage() {
  const { can } = useAuth();
  const api = getBrowserApiUrl();
  const [items, setItems] = useState<WorkflowRecord[]>([]);
  const [banks, setBanks] = useState<CatalogItem[]>([]);
  const [products, setProducts] = useState<CatalogItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [message, setMessage] = useState("");
  const [bankId, setBankId] = useState("");
  const [productId, setProductId] = useState("");
  const [stageName, setStageName] = useState("");
  const [stageCode, setStageCode] = useState("");
  const [fromStage, setFromStage] = useState("");
  const [toStage, setToStage] = useState("");

  const refresh = useCallback(async () => {
    const [workflowData, bankData, productData] = await Promise.all([
      apiGet<{ items: WorkflowRecord[] }>("/api/v1/workflows", api),
      apiGet<{ items: CatalogItem[] }>("/api/v1/banks", api),
      apiGet<{ items: CatalogItem[] }>("/api/v1/products", api),
    ]);
    setItems(workflowData.items);
    setBanks(bankData.items);
    setProducts(productData.items);
    if (!selectedId && workflowData.items[0]) {
      setSelectedId(workflowData.items[0].id);
    }
  }, [api, selectedId]);

  useEffect(() => {
    void refresh().catch((err: unknown) =>
      setMessage(err instanceof Error ? err.message : "Load failed"),
    );
  }, [refresh]);

  const selected = items.find((item) => item.id === selectedId) ?? items[0];

  async function createVersion() {
    setMessage("");
    try {
      const created = await apiRequest<WorkflowRecord>("/api/v1/workflows", api, {
        method: "POST",
        body: JSON.stringify({ bank_id: bankId, product_id: productId }),
      });
      await refresh();
      setSelectedId(created.id);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Create failed");
    }
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Workflows"
        description="Workflows are versioned per Bank and Product. Application Created is the only globally fixed entry stage. Other stages and transitions are configured here; they are not seeded."
      />
      <ErrorText>{message}</ErrorText>
      {can("WorkflowStages.Create") ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void createVersion();
          }}
        >
          <select
            className={controlClass}
            aria-label="Workflow bank"
            value={bankId}
            onChange={(event) => setBankId(event.target.value)}
            required
          >
            <option value="">Bank</option>
            {banks.map((bank) => (
              <option key={bank.id} value={bank.id}>
                {bank.code}
              </option>
            ))}
          </select>
          <select
            className={controlClass}
            aria-label="Workflow product"
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
            required
          >
            <option value="">Product</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.code}
              </option>
            ))}
          </select>
          <button className={primaryButtonClass} type="submit">
            Create new version
          </button>
        </form>
      ) : null}
      <select
        className={controlClass}
        aria-label="Workflow version"
        value={selected?.id ?? ""}
        onChange={(event) => setSelectedId(event.target.value)}
      >
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.bank?.code}/{item.product?.code} v{item.version} ({item.status})
          </option>
        ))}
      </select>
      {selected ? (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-5">
          <h3 className="font-semibold">
            {selected.bank?.code} / {selected.product?.code} version {selected.version}
          </h3>
          <ol className="space-y-1 text-sm">
            {selected.stages.map((stage) => (
              <li key={stage.id}>
                {stage.sortOrder}. {stage.name} ({stage.status})
                {can("WorkflowStages.Deactivate") &&
                stage.systemKey !== "application_created" &&
                stage.status === "active" ? (
                  <button
                    className="ml-2 underline"
                    type="button"
                    onClick={() =>
                      void apiRequest(`/api/v1/workflows/stages/${stage.id}/deactivate`, api, {
                        method: "POST",
                      }).then(refresh)
                    }
                  >
                    Deactivate
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
          {can("WorkflowStages.Create") ? (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void apiRequest(`/api/v1/workflows/${selected.id}/stages`, api, {
                  method: "POST",
                  body: JSON.stringify({
                    name: stageName,
                    code: stageCode,
                    sort_order: (selected.stages.at(-1)?.sortOrder ?? 70) + 10,
                  }),
                }).then(refresh);
              }}
            >
              <input
                className={controlClass}
                aria-label="Stage name"
                placeholder="Stage name"
                value={stageName}
                onChange={(event) => setStageName(event.target.value)}
                required
              />
              <input
                className={controlClass}
                aria-label="Stage code"
                placeholder="Stage code"
                value={stageCode}
                onChange={(event) => setStageCode(event.target.value)}
                required
              />
              <button className={secondaryButtonClass} type="submit">
                Add stage
              </button>
            </form>
          ) : null}
          <p className="text-sm font-medium">Allowed transitions</p>
          <ul className="text-sm">
            {selected.transitions.map((row) => {
              const from = selected.stages.find((stage) => stage.id === row.fromStageId);
              const to = selected.stages.find((stage) => stage.id === row.toStageId);
              return (
                <li key={row.id}>
                  {from?.name} → {to?.name}
                </li>
              );
            })}
          </ul>
          {can("WorkflowStages.ConfigureTransitions") ? (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void apiRequest(`/api/v1/workflows/${selected.id}/transitions`, api, {
                  method: "PUT",
                  body: JSON.stringify({
                    items: [
                      ...selected.transitions.map((row) => ({
                        from_stage_id: row.fromStageId,
                        to_stage_id: row.toStageId,
                      })),
                      { from_stage_id: fromStage, to_stage_id: toStage },
                    ],
                  }),
                }).then(refresh);
              }}
            >
              <select
                className={controlClass}
                aria-label="From stage"
                value={fromStage}
                onChange={(event) => setFromStage(event.target.value)}
                required
              >
                <option value="">From</option>
                {selected.stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </select>
              <select
                className={controlClass}
                aria-label="To stage"
                value={toStage}
                onChange={(event) => setToStage(event.target.value)}
                required
              >
                <option value="">To</option>
                {selected.stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </select>
              <button className={secondaryButtonClass} type="submit">
                Add transition
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
