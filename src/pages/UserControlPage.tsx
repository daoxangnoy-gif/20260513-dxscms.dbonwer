import { Users } from "lucide-react";

export default function UserControlPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
      <Users className="w-16 h-16 mb-4 opacity-30" />
      <h2 className="text-lg font-semibold text-foreground">User Control</h2>
      <p className="text-sm mt-2">จัดการผู้ใช้งานและสิทธิ์การเข้าถึง</p>
      <p className="text-xs mt-1">รอการออกแบบเพิ่มเติม</p>
    </div>
  );
}
