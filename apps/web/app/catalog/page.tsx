"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { ErrorText, PageHeader, controlClass, primaryButtonClass } from "@/components/ui";
import { apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { BankProductRecord, CatalogItem } from "@/lib/types";

export default function CatalogPage() {
  const { can } = useAuth();
  const [banks, setBanks] = useState<CatalogItem[]>([]);
  const [products, setProducts] = useState<CatalogItem[]>([]);
  const [mappings, setMappings] = useState<BankProductRecord[]>([]);
  const [message, setMessage] = useState("");
  const api = getBrowserApiUrl();
  const canSeeInactive =
    can("Banks.Edit") || can("Products.Edit") || can("BankProducts.Create");

  const refresh = useCallback(async () => {
    const suffix = canSeeInactive ? "?includeInactive=true" : "";
    const [bankData, productData, mappingData] = await Promise.all([
      apiGet<{ items: CatalogItem[] }>(`/api/v1/banks${suffix}`, api),
      apiGet<{ items: CatalogItem[] }>(`/api/v1/products${suffix}`, api),
      apiGet<{ items: BankProductRecord[] }>(`/api/v1/bank-products${suffix}`, api),
    ]);
    setBanks(bankData.items);
    setProducts(productData.items);
    setMappings(mappingData.items);
  }, [api, canSeeInactive]);

  useEffect(() => {
    void refresh().catch((err: unknown) => setMessage(err instanceof Error ? err.message : "Load failed"));
  }, [refresh]);

  async function createMaster(path: string, body: Record<string, string>) {
    setMessage("");
    try {
      await apiRequest(path, api, { method: "POST", body: JSON.stringify(body) });
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <section className="space-y-8">
      <PageHeader title="Banks and products" />
      <ErrorText>{message}</ErrorText>
      <MasterSection
        title="Banks"
        items={banks}
        canCreate={can("Banks.Create")}
        canEdit={can("Banks.Edit")}
        canActivate={can("Banks.Activate")}
        canDeactivate={can("Banks.Deactivate")}
        onCreate={(name, code) => void createMaster("/api/v1/banks", { name, code })}
        onRename={(id, name) =>
          void apiRequest(`/api/v1/banks/${id}`, api, {
            method: "PATCH",
            body: JSON.stringify({ name }),
          }).then(refresh)
        }
        onActivate={(id) =>
          void apiRequest(`/api/v1/banks/${id}/activate`, api, { method: "POST" }).then(refresh)
        }
        onDeactivate={(id) =>
          void apiRequest(`/api/v1/banks/${id}/deactivate`, api, { method: "POST" }).then(refresh)
        }
      />
      <MasterSection
        title="Products"
        items={products}
        canCreate={can("Products.Create")}
        canEdit={can("Products.Edit")}
        canActivate={can("Products.Activate")}
        canDeactivate={can("Products.Deactivate")}
        onCreate={(name, code) => void createMaster("/api/v1/products", { name, code })}
        onRename={(id, name) =>
          void apiRequest(`/api/v1/products/${id}`, api, {
            method: "PATCH",
            body: JSON.stringify({ name }),
          }).then(refresh)
        }
        onActivate={(id) =>
          void apiRequest(`/api/v1/products/${id}/activate`, api, { method: "POST" }).then(refresh)
        }
        onDeactivate={(id) =>
          void apiRequest(`/api/v1/products/${id}/deactivate`, api, { method: "POST" }).then(refresh)
        }
      />
      {can("Products.Edit") ? (
        <section className="space-y-3">
          <h3 className="font-semibold">Product amount rules</h3>
          <table className="min-w-full rounded-xl border bg-white text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left">Product</th>
                <th className="px-3 py-2 text-left">Requested</th>
                <th className="px-3 py-2 text-left">Approved</th>
                <th className="px-3 py-2 text-left">Booked</th>
                <th className="px-3 py-2 text-left">Funded</th>
                <th className="px-3 py-2 text-left">Target measurement</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className="border-t">
                  <td className="px-3 py-2">{product.code}</td>
                  {(
                    [
                      ["requested_amount_required", product.requestedAmountRequired],
                      ["approved_amount_required", product.approvedAmountRequired],
                      ["booked_amount_required", product.bookedAmountRequired],
                      ["funded_amount_required", product.fundedAmountRequired],
                    ] as const
                  ).map(([field, value]) => (
                    <td key={field} className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`${product.code} ${field}`}
                        checked={Boolean(value)}
                        onChange={(event) =>
                          void apiRequest(`/api/v1/products/${product.id}/field-rules`, api, {
                            method: "PUT",
                            body: JSON.stringify({ [field]: event.target.checked }),
                          }).then(refresh)
                        }
                      />
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    <select
                      aria-label={`${product.code} target measurement`}
                      className={controlClass}
                      value={product.targetMeasurement ?? "count"}
                      onChange={(event) =>
                        void apiRequest(`/api/v1/products/${product.id}/field-rules`, api, {
                          method: "PUT",
                          body: JSON.stringify({ target_measurement: event.target.value }),
                        }).then(refresh)
                      }
                    >
                      <option value="count">Count</option>
                      <option value="amount">Amount</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      <section className="space-y-3">
        <h3 className="font-semibold">Bank-product mappings</h3>
        {can("BankProducts.Create") && banks[0] && products[0] ? (
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const bankId = (document.getElementById("map-bank") as HTMLSelectElement).value;
              const productId = (document.getElementById("map-product") as HTMLSelectElement).value;
              void createMaster("/api/v1/bank-products", { bank_id: bankId, product_id: productId });
            }}
          >
            <select id="map-bank" className={controlClass} defaultValue={banks[0].id}>
              {banks.map((bank) => (
                <option key={bank.id} value={bank.id}>
                  {bank.code}
                </option>
              ))}
            </select>
            <select
              id="map-product"
              className={controlClass}
              defaultValue={products[0].id}
            >
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.code}
                </option>
              ))}
            </select>
            <button className={primaryButtonClass} type="submit">
              Add mapping
            </button>
          </form>
        ) : null}
        <table className="min-w-full rounded-xl border bg-white text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left">Bank</th>
              <th className="px-3 py-2 text-left">Product</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {mappings.map((item) => (
              <tr key={item.id} className="border-t">
                <td className="px-3 py-2">{item.bank?.code}</td>
                <td className="px-3 py-2">{item.product?.code}</td>
                <td className="px-3 py-2">{item.status}</td>
                <td className="px-3 py-2">
                  {item.status === "active" && can("BankProducts.Deactivate") ? (
                    <button
                      className="text-sm underline"
                      type="button"
                      onClick={() =>
                        void apiRequest(`/api/v1/bank-products/${item.id}/deactivate`, api, {
                          method: "POST",
                        }).then(refresh)
                      }
                    >
                      Deactivate
                    </button>
                  ) : null}
                  {item.status === "inactive" && can("BankProducts.Activate") ? (
                    <button
                      className="text-sm underline"
                      type="button"
                      onClick={() =>
                        void apiRequest(`/api/v1/bank-products/${item.id}/activate`, api, {
                          method: "POST",
                        }).then(refresh)
                      }
                    >
                      Activate
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </section>
  );
}

function MasterSection({
  title,
  items,
  canCreate,
  canEdit,
  canActivate,
  canDeactivate,
  onCreate,
  onRename,
  onActivate,
  onDeactivate,
}: {
  title: string;
  items: CatalogItem[];
  canCreate: boolean;
  canEdit: boolean;
  canActivate: boolean;
  canDeactivate: boolean;
  onCreate: (name: string, code: string) => void;
  onRename: (id: string, name: string) => void;
  onActivate: (id: string) => void;
  onDeactivate: (id: string) => void;
}) {
  return (
    <section className="space-y-3">
      <h3 className="font-semibold">{title}</h3>
      {canCreate ? <CreateForm onCreate={onCreate} /> : null}
      <table className="min-w-full rounded-xl border bg-white text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-3 py-2 text-left">Code</th>
            <th className="px-3 py-2 text-left">Name</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-t">
              <td className="px-3 py-2">{item.code}</td>
              <td className="px-3 py-2">
                {canEdit ? (
                  <RenameName value={item.name} onSave={(name) => onRename(item.id, name)} />
                ) : (
                  item.name
                )}
              </td>
              <td className="px-3 py-2">{item.status}</td>
              <td className="px-3 py-2">
                {item.status === "active" && canDeactivate ? (
                  <button className="text-sm underline" type="button" onClick={() => onDeactivate(item.id)}>
                    Deactivate
                  </button>
                ) : null}
                {item.status === "inactive" && canActivate ? (
                  <button className="text-sm underline" type="button" onClick={() => onActivate(item.id)}>
                    Activate
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function CreateForm({
  onCreate,
  extra,
}: {
  onCreate: (name: string, code: string) => void;
  extra?: ReactNode;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onCreate(name, code);
        setName("");
        setCode("");
      }}
    >
      {extra}
      <input
        className={controlClass}
        placeholder="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
      />
      <input
        className={controlClass}
        placeholder="Immutable code"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        required
      />
      <button className={primaryButtonClass} type="submit">
        Create
      </button>
    </form>
  );
}

function RenameName({ value, onSave }: { value: string; onSave: (name: string) => void }) {
  const [name, setName] = useState(value);
  useEffect(() => {
    setName(value);
  }, [value]);
  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(name);
      }}
    >
      <input
        className={`${controlClass} py-1`}
        value={name}
        onChange={(event) => setName(event.target.value)}
        aria-label="Name"
      />
      <button className="text-xs underline" type="submit">
        Save
      </button>
    </form>
  );
}
