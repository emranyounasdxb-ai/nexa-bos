"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { Pagination, useClientPagination } from "@/components/pagination";
import { Button, ErrorText, PageHeader, StatusBadge, TableHead, TableShell, Td, Th, controlClass, primaryButtonClass } from "@/components/ui";
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
  const productRulesPagination = useClientPagination(products);
  const mappingPagination = useClientPagination(mappings);

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
      <PageHeader
        title="Banks and products"
        description="Manage the authorized bank, product, amount-rule, and mapping catalogue."
      />
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
          <TableShell className="rounded-b-none">
            <TableHead>
              <tr>
                <Th>Product</Th>
                <Th>Requested</Th>
                <Th>Approved</Th>
                <Th>Booked</Th>
                <Th>Funded</Th>
                <Th>Target measurement</Th>
              </tr>
            </TableHead>
            <tbody>
              {productRulesPagination.pagedItems.map((product) => (
                <tr key={product.id}>
                  <Td>{product.code}</Td>
                  {(
                    [
                      ["requested_amount_required", product.requestedAmountRequired],
                      ["approved_amount_required", product.approvedAmountRequired],
                      ["booked_amount_required", product.bookedAmountRequired],
                      ["funded_amount_required", product.fundedAmountRequired],
                    ] as const
                  ).map(([field, value]) => (
                    <Td key={field}>
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
                    </Td>
                  ))}
                  <Td>
                    <select
                      aria-label={`${product.code} target measurement`}
                      className={`${controlClass} !min-h-8 !py-1 text-xs`}
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
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
          <Pagination
            className="-mt-3 rounded-b-[10px] border border-slate-200"
            page={productRulesPagination.page}
            pageSize={productRulesPagination.pageSize}
            total={productRulesPagination.total}
            totalPages={productRulesPagination.totalPages}
            onPageChange={productRulesPagination.setPage}
            onPageSizeChange={productRulesPagination.setPageSize}
          />
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
        <TableShell className="rounded-b-none">
          <TableHead>
            <tr>
              <Th>Bank</Th>
              <Th>Product</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </tr>
          </TableHead>
          <tbody>
            {mappingPagination.pagedItems.map((item) => (
              <tr key={item.id}>
                <Td>{item.bank?.code}</Td>
                <Td>{item.product?.code}</Td>
                <Td><StatusBadge value={item.status} /></Td>
                <Td>
                  {item.status === "active" && can("BankProducts.Deactivate") ? (
                    <Button
                      variant="secondary"
                      size="compact"
                      type="button"
                      onClick={() =>
                        void apiRequest(`/api/v1/bank-products/${item.id}/deactivate`, api, {
                          method: "POST",
                        }).then(refresh)
                      }
                    >
                      Deactivate
                    </Button>
                  ) : null}
                  {item.status === "inactive" && can("BankProducts.Activate") ? (
                    <Button
                      variant="secondary"
                      size="compact"
                      type="button"
                      onClick={() =>
                        void apiRequest(`/api/v1/bank-products/${item.id}/activate`, api, {
                          method: "POST",
                        }).then(refresh)
                      }
                    >
                      Activate
                    </Button>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
        <Pagination
          className="-mt-3 rounded-b-[10px] border border-slate-200"
          page={mappingPagination.page}
          pageSize={mappingPagination.pageSize}
          total={mappingPagination.total}
          totalPages={mappingPagination.totalPages}
          onPageChange={mappingPagination.setPage}
          onPageSizeChange={mappingPagination.setPageSize}
        />
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
  const pagination = useClientPagination(items);
  return (
    <section className="space-y-3">
      <h3 className="font-semibold">{title}</h3>
      {canCreate ? <CreateForm onCreate={onCreate} /> : null}
      <TableShell className="rounded-b-none">
        <TableHead>
          <tr>
            <Th>Code</Th>
            <Th>Name</Th>
            <Th>Status</Th>
            <Th>Actions</Th>
          </tr>
        </TableHead>
        <tbody>
          {pagination.pagedItems.map((item) => (
            <tr key={item.id}>
              <Td>{item.code}</Td>
              <Td>
                {canEdit ? (
                  <RenameName value={item.name} onSave={(name) => onRename(item.id, name)} />
                ) : (
                  item.name
                )}
              </Td>
              <Td><StatusBadge value={item.status} /></Td>
              <Td>
                {item.status === "active" && canDeactivate ? (
                  <Button variant="secondary" size="compact" type="button" onClick={() => onDeactivate(item.id)}>
                    Deactivate
                  </Button>
                ) : null}
                {item.status === "inactive" && canActivate ? (
                  <Button variant="secondary" size="compact" type="button" onClick={() => onActivate(item.id)}>
                    Activate
                  </Button>
                ) : null}
              </Td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      <Pagination
        className="-mt-3 rounded-b-[10px] border border-slate-200"
        page={pagination.page}
        pageSize={pagination.pageSize}
        total={pagination.total}
        totalPages={pagination.totalPages}
        onPageChange={pagination.setPage}
        onPageSizeChange={pagination.setPageSize}
      />
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
        className={`${controlClass} !min-h-8 !py-1 text-xs`}
        value={name}
        onChange={(event) => setName(event.target.value)}
        aria-label="Name"
      />
      <Button variant="secondary" size="compact" type="submit">
        Save
      </Button>
    </form>
  );
}
