import { KitEditor } from "@/components/super-admin/kit-editor"
import { EMPTY_TARGET } from "@/lib/kits/schema"

export default function NewKitPage() {
  return (
    <KitEditor
      title="Add kit"
      projectCount={0}
      initial={{
        id: "",
        name: "",
        version: "1.0",
        active: true,
        layoutOrientation: "tubes_in_rows",
        targets: [{ ...EMPTY_TARGET }],
      }}
    />
  )
}
