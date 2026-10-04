// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App";
import { JSDOM } from "jsdom";
import { Blob as NodeBlob } from "node:buffer";
import { blankProfile, readProfile, STORAGE_KEY } from "./lib/profiles";
import { testConfig } from "./lib/test-config";

const config = testConfig();
const browserStorage = new JSDOM("", { url: "http://127.0.0.1:5174/" }).window.localStorage;
vi.mock("./lib/api", () => ({ fetchConfig: vi.fn() }));
import { fetchConfig } from "./lib/api";

beforeEach(() => { vi.stubGlobal("localStorage", browserStorage); localStorage.clear(); vi.mocked(fetchConfig).mockResolvedValue(config); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const mount = async () => { render(<App />); await screen.findByRole("heading", { name: "DDR5 timing analyzer" }); };

describe("notebook workflows", () => {
  it("exports a valid, portable profile with a filesystem-safe filename", async () => {
    vi.stubGlobal("Blob", NodeBlob);
    const createObjectURL = vi.fn((_value: NodeBlob) => "blob:profile-export");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    let filename = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; });
    await mount();
    fireEvent.change(screen.getByLabelText("Profile name"), { target: { value: "Daily: 6000 / CL30" } });
    fireEvent.click(screen.getByRole("button", { name: "Export profile" }));
    expect(filename).toBe("Daily_6000_CL30.json");
    const exported = JSON.parse(await createObjectURL.mock.calls[0][0].text());
    expect(readProfile(exported, config)).toEqual(JSON.parse(localStorage.getItem(STORAGE_KEY)!).draft);
  });
  it("saves immutable snapshots, restores the draft, and compares with a baseline", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("Profile name"), { target: { value: "My baseline" } });
    fireEvent.change(screen.getByLabelText("Load an example"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save snapshot" }));
    const notebook = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(notebook.saved).toHaveLength(1);
    expect(notebook.saved[0].profile.mtps).toBe(6000);
    fireEvent.change(screen.getByLabelText("Data rate (MT/s)"), { target: { value: "6400" } });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).saved[0].profile.mtps).toBe(6000);
    fireEvent.change(screen.getByLabelText("Compare current draft with"), { target: { value: notebook.saved[0].id } });
    const comparison = screen.getByRole("table", { name: "Current draft versus saved baseline" });
    expect(within(comparison).getByText("+400 MT/s")).toBeTruthy();
    cleanup(); await mount();
    expect((screen.getByLabelText("Data rate (MT/s)") as HTMLInputElement).value).toBe("6400");
    expect(screen.getByText("Restored your local notebook.")).toBeTruthy();
  });
  it("blocks invalid drafts without overwriting the last valid autosave", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("Data rate (MT/s)"), { target: { value: "0" } });
    expect(screen.getByRole("alert").textContent).toContain("Data rate must be a whole number");
    expect((screen.getByRole("button", { name: "Save snapshot" }) as HTMLButtonElement).disabled).toBe(true);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).draft.mtps).toBe(6000);
    fireEvent.change(screen.getByLabelText("Data rate (MT/s)"), { target: { value: "6200" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).draft.mtps).toBe(6200);
  });
  it("resets test status after hardware edits and retains evidence notes", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText(/^External test status/), { target: { value: "passed" } });
    fireEvent.change(screen.getByLabelText("Test evidence"), { target: { value: "MemTest86: 4 passes, no errors" } });
    fireEvent.change(screen.getByLabelText("Data rate (MT/s)"), { target: { value: "6200" } });
    expect((screen.getByLabelText(/^External test status/) as HTMLSelectElement).value).toBe("untested");
    expect((screen.getByLabelText("Test evidence") as HTMLTextAreaElement).value).toContain("4 passes");
  });
  it("removes and restores a snapshot through Undo", async () => {
    await mount(); fireEvent.click(screen.getByRole("button", { name: "Save snapshot" }));
    fireEvent.click(screen.getByRole("button", { name: /^Remove snapshot/ }));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).saved).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Undo removal" }));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).saved).toHaveLength(1);
  });
  it("handles storage failures and preserves corrupt existing data", async () => {
    localStorage.setItem(STORAGE_KEY, "unreadable-backup");
    await mount();
    expect(screen.getByRole("alert").textContent).toContain("Local storage could not be read");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("unreadable-backup");
    fireEvent.change(screen.getByLabelText("Profile name"), { target: { value: "Still editable" } });
    expect((screen.getByLabelText("Profile name") as HTMLInputElement).value).toBe("Still editable");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("unreadable-backup");
  });
  it("keeps edits available when storage quota is exceeded", async () => {
    const save = vi.spyOn(Object.getPrototypeOf(browserStorage), "setItem").mockImplementation(() => { throw new Error("quota"); });
    await mount();
    expect((await screen.findByRole("alert")).textContent).toContain("Local saving failed");
    fireEvent.change(screen.getByLabelText("Profile name"), { target: { value: "In memory" } });
    expect((screen.getByLabelText("Profile name") as HTMLInputElement).value).toBe("In memory");
    save.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Save current notebook locally" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).draft.profile_name).toBe("In memory");
  });
  it("retries a failed initial database load", async () => {
    vi.mocked(fetchConfig).mockRejectedValueOnce(new Error("Database unavailable"));
    render(<App />);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry loading database" }));
    await screen.findByRole("heading", { name: "DDR5 timing analyzer" });
  });
  it("imports an exported profile and reports invalid JSON without changing the draft", async () => {
    await mount();
    const profile = { ...blankProfile(), profile_name: "Imported profile", timings: { tCL: 30 } };
    const input = screen.getByLabelText("Import profile or HWiNFO report");
    fireEvent.change(input, { target: { files: [{ name: "profile.json", size: 200, text: async () => JSON.stringify(profile) }] } });
    await waitFor(() => expect((screen.getByLabelText("Profile name") as HTMLInputElement).value).toBe("Imported profile"));
    fireEvent.change(input, { target: { files: [{ name: "broken.json", size: 1, text: async () => "{" }] } });
    await screen.findByRole("alert");
    expect((screen.getByLabelText("Profile name") as HTMLInputElement).value).toBe("Imported profile");
  });
});
