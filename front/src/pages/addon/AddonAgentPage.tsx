import { useEffect, useState, Suspense } from "react";
import { useParams } from "react-router";
import GenericAddonPage from "./GenericAddonPage";

// Vite resolves this glob at build time — any .tsx in deployed/ is automatically included.
// After uploading an addon with a -front.tsx file, rebuild the frontend to activate it.
const addonModules = import.meta.glob("./deployed/*.tsx");

export default function AddonAgentPage() {
  const { agentKey } = useParams<{ agentKey: string }>();
  const [Component, setComponent] = useState<React.ComponentType | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!agentKey) { setChecked(true); return; }
    const moduleKey = `./deployed/${agentKey}.tsx`;
    if (addonModules[moduleKey]) {
      addonModules[moduleKey]()
        .then((mod: any) => { setComponent(() => mod.default); setChecked(true); })
        .catch((err) => {
          console.error(`[AddonAgentPage] ${moduleKey} import 실패 — GenericAddonPage로 폴백`, err);
          setChecked(true);
        });
    } else {
      console.warn(`[AddonAgentPage] ${moduleKey} 미포함 — web 이미지가 이 addon 배포 이전에 빌드됨 (재빌드 필요). GenericAddonPage로 폴백`);
      setChecked(true);
    }
  }, [agentKey]);

  if (!checked) return null;

  if (Component) {
    return (
      <Suspense fallback={<div className="p-6 text-sm text-gray-400">Loading...</div>}>
        <Component />
      </Suspense>
    );
  }

  return <GenericAddonPage />;
}
