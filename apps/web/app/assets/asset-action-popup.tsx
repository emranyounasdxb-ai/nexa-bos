"use client";
import { type ComponentProps } from "react";
import { PanelPopup } from "@/components/panel-popup";

// Reuse the shared popup while allowing its lower asset drawer to relinquish focus.
export function AssetActionPopup(props: ComponentProps<typeof PanelPopup>) {
  return <PanelPopup {...props} parentModalSelector="[data-asset-workspace-drawer]" />;
}
