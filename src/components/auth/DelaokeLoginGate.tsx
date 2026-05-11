"use client";

import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CodePilotLogo } from "@/components/chat/CodePilotLogo";
import { SpinnerGap } from "@/components/ui/icon";

const SESSION_KEY = "delaoke:new-api:session";
const DEFAULT_BASE_URL = "https://server.opeease.com:3000";

interface LoginSession {
  username: string;
  baseUrl: string;
  providerId?: string;
  loggedInAt: string;
}

type AuthMode = "login" | "register";

function readStoredSession(): LoginSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LoginSession>;
    if (!parsed.username || !parsed.baseUrl) return null;
    return {
      username: parsed.username,
      baseUrl: parsed.baseUrl,
      providerId: parsed.providerId,
      loggedInAt: parsed.loggedInAt || new Date().toISOString(),
    };
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function DelaokeLoginGate({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);
  const [mode, setMode] = useState<AuthMode>("login");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [email, setEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [affCode, setAffCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const stored = readStoredSession();

    fetch("/api/new-api/bind")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.baseUrl) setBaseUrl(data.baseUrl);
        if (stored && data?.loggedIn) {
          setLoggedIn(true);
        } else if (data?.username) {
          setUsername(data.username);
        }
      })
      .catch(() => {
        if (stored) setLoggedIn(true);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const completeLogin = (data: { username?: string; provider?: { id?: string } }) => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      username: data.username || username,
      baseUrl,
      providerId: data.provider?.id,
      loggedInAt: new Date().toISOString(),
    }));
    setPassword("");
    setConfirmPassword("");
    setLoggedIn(true);
    window.dispatchEvent(new Event("provider-changed"));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      if (mode === "register" && password !== confirmPassword) {
        throw new Error("两次输入的密码不一致");
      }

      const res = await fetch(mode === "register" ? "/api/new-api/register" : "/api/new-api/bind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl,
          username,
          password,
          ...(mode === "register" ? {
            email,
            verificationCode,
            affCode,
          } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || (mode === "register" ? "注册失败，请检查信息" : "登录失败，请检查账号或密码"));
      }
      completeLogin(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败，请稍后再试");
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <SpinnerGap size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loggedIn) return <>{children}</>;

  const isRegister = mode === "register";
  const submitDisabled = submitting || !baseUrl || !username || !password || (isRegister && !confirmPassword);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <div className="hidden flex-1 items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(19,203,185,0.18),transparent_36%),linear-gradient(135deg,#07111f,#0b1f33_46%,#061a18)] p-10 lg:flex">
        <div className="max-w-md">
          <CodePilotLogo className="mb-8 h-24 w-24 shadow-2xl" />
          <h1 className="text-4xl font-semibold tracking-normal text-white">德劳克</h1>
          <p className="mt-4 text-base leading-7 text-white/72">
            登录或注册 New API 账号后，系统会自动绑定模型和 API Key。
          </p>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-center px-6 py-10">
        <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5">
          <div className="space-y-2">
            <CodePilotLogo className="h-14 w-14 lg:hidden" />
            <h2 className="text-2xl font-semibold tracking-normal">
              {isRegister ? "注册德劳克账号" : "登录德劳克"}
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {isRegister
                ? "直接创建 New API 账号，成功后自动登录并写入服务商配置。"
                : "登录后会自动写入服务商配置，不需要客户手动填写 API。"}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
            <Button type="button" variant={mode === "login" ? "secondary" : "ghost"} size="sm" onClick={() => setMode("login")}>
              登录
            </Button>
            <Button type="button" variant={mode === "register" ? "secondary" : "ghost"} size="sm" onClick={() => setMode("register")}>
              注册
            </Button>
          </div>

          <div className="space-y-3">
            <Input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={DEFAULT_BASE_URL}
              autoComplete="url"
            />
            <Input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="用户名"
              autoComplete="username"
              autoFocus
            />
            {isRegister && (
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="邮箱（可选）"
                autoComplete="email"
              />
            )}
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="密码"
              autoComplete={isRegister ? "new-password" : "current-password"}
            />
            {isRegister && (
              <>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="确认密码"
                  autoComplete="new-password"
                />
                <Input
                  value={verificationCode}
                  onChange={(event) => setVerificationCode(event.target.value)}
                  placeholder="邮箱验证码（如开启验证时填写）"
                />
                <Input
                  value={affCode}
                  onChange={(event) => setAffCode(event.target.value)}
                  placeholder="邀请码（可选）"
                />
              </>
            )}
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <Button className="w-full" type="submit" disabled={submitDisabled}>
            {submitting && <SpinnerGap size={16} className="animate-spin" />}
            {isRegister ? "注册并进入" : "登录并进入"}
          </Button>
        </form>
      </div>
    </div>
  );
}
