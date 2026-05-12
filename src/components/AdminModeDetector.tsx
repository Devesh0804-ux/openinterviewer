'use client'

import { useEffect } from "react";
import { useStore } from "@/store";

export default function AdminModeDetector() {

  const setViewMode = useStore((state) => state.setViewMode);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");

    if (mode === "admin") {
      setViewMode("admin");

      // remove ?mode=admin from URL
      window.history.replaceState({}, "", "/dashboard");
    }
  }, []);

  return null;
}