import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { AuthProvider, useAuth } from "@/hooks/useAuth";

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe("useAuth", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.history.pushState({}, "", "/holdings");
  });

  it("does NOT auto-enable demo mode on plain /holdings when Supabase is unconfigured", () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.isConfigured).toBe(false);
    expect(result.current.isDemoMode).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it("enters and exits demo mode explicitly via enterDemoMode and exitDemoMode", () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    act(() => {
      result.current.enterDemoMode();
    });
    expect(result.current.isDemoMode).toBe(true);
    expect(result.current.user?.id).toBe("demo-user");
    expect(window.sessionStorage.getItem("stockify_demo_mode")).toBe("1");

    act(() => {
      result.current.exitDemoMode();
    });
    expect(result.current.isDemoMode).toBe(false);
    expect(result.current.user).toBeNull();
    expect(window.sessionStorage.getItem("stockify_demo_mode")).toBeNull();
  });

  it("activates demo mode when ?demo=1 query param is present", () => {
    window.history.pushState({}, "", "/holdings?demo=1");
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.isDemoMode).toBe(true);
    expect(result.current.user?.id).toBe("demo-user");
  });
});
