import { History } from "lucide-react";

export default function LogPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
      <History className="w-16 h-16 mb-4 opacity-30" />
      <h2 className="text-lg font-semibold text-foreground">Log</h2>
      <p className="text-sm mt-2">แทร็กการเปลี่ยนแปลงข้อมูล</p>
      <p className="text-xs mt-1">รอการออกแบบเพิ่มเติม</p>
    </div>
  );
}
