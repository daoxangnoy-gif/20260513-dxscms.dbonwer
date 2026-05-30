import { Component, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallbackLabel?: string;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  reset = () => this.setState({ hasError: false, message: "" });

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <AlertTriangle className="w-10 h-10 text-destructive" />
        <div>
          <p className="font-semibold text-base">
            {this.props.fallbackLabel ?? "เกิดข้อผิดพลาดที่ไม่คาดคิด"}
          </p>
          {this.state.message && (
            <p className="mt-1 text-sm text-muted-foreground font-mono">{this.state.message}</p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={this.reset}>
          <RefreshCw className="w-4 h-4 mr-2" />
          ลองอีกครั้ง
        </Button>
      </div>
    );
  }
}
