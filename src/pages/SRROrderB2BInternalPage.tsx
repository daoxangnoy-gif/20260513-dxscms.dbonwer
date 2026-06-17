import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tag } from "lucide-react";

export default function SRROrderB2BInternalPage() {
  const [activeTab, setActiveTab] = useState("brand");

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b px-4 pt-3">
          <TabsList className="h-8">
            <TabsTrigger value="brand" className="text-xs gap-1.5">
              <Tag className="w-3.5 h-3.5" /> Brand
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="brand" className="flex-1 overflow-auto mt-0 p-4 bg-background">
          <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
            <p className="text-sm">หน้านี้อยู่ระหว่างพัฒนา — ยังไม่มีฟังก์ชันการทำงาน</p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
