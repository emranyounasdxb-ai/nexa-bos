"use client";
import { useParams } from "next/navigation";
import { AssetManagementWorkspace } from "../asset-workspace";
export default function AssetPage() { const { id } = useParams<{ id: string }>(); return <AssetManagementWorkspace initialAssetId={id} />; }
