import { getDatastore } from "./datastore";
import { fireOnSettingsChanged } from "@/ipc/window/settings";
import { BasicSettings } from "@/modules/basic-settings";
import { TypedEventEmitter } from "@/modules/typed-event-emitter";
import { debugPrint } from "@/modules/output";
import { BasicSetting, SettingType } from "~/types/settings";

export const SettingsDataStore = getDatastore("settings");

type SettingsEvents = {
  "settings-changed": [];
};
export const settingsEmitter = new TypedEventEmitter<SettingsEvents>();

// Settings: Current Icon //
// Find in `@/modules/icons.ts`

// Settings: Settings Config //
const basicSettingsCurrentValues: Record<string, SettingType["defaultValue"]> = {};

function validateSettingValue<T extends SettingType>(setting: T, value: unknown) {
  if (setting.type === "boolean") {
    return typeof value === "boolean";
  }
  if (setting.type === "enum") {
    return setting.options.some((option) => option.id === value);
  }
  return false;
}

async function cacheSetting(setting: BasicSetting) {
  const value = await SettingsDataStore.get<SettingType["defaultValue"]>(setting.id).catch(() => undefined);
  if (value !== undefined && validateSettingValue(setting, value)) {
    basicSettingsCurrentValues[setting.id] = value;
  } else {
    basicSettingsCurrentValues[setting.id] = setting.defaultValue;
  }
}

/**
 * Records which setting migrations have already run, so that a value the user
 * picks *after* a migration is never rewritten again.
 */
const APPLIED_MIGRATIONS_KEY = "__appliedSettingMigrations";

/**
 * One-time migrations for values written to the datastore by older builds.
 *
 * `sleepTabAfter` used to default to "never", which keeps a renderer process
 * alive for every background tab (~20-50MB each). Only that legacy default is
 * rewritten - an explicitly chosen value such as "30m" is left untouched.
 */
const SETTING_VALUE_MIGRATIONS: Record<string, { from: unknown; to: SettingType["defaultValue"] }> = {
  sleepTabAfter: { from: "never", to: "10m" }
};

async function applySettingMigrations() {
  const applied = await SettingsDataStore.get<unknown>(APPLIED_MIGRATIONS_KEY).catch(() => undefined);
  const alreadyApplied = new Set<string>(Array.isArray(applied) ? applied.filter((id) => typeof id === "string") : []);

  const pending = Object.keys(SETTING_VALUE_MIGRATIONS).filter((id) => !alreadyApplied.has(id));
  if (pending.length === 0) return;

  for (const id of pending) {
    const setting = BasicSettings.find((candidate) => candidate.id === id);
    const migration = SETTING_VALUE_MIGRATIONS[id];
    if (!setting) continue;

    const current = await SettingsDataStore.get<unknown>(id).catch(() => undefined);
    if (current === migration.from && validateSettingValue(setting, migration.to)) {
      await SettingsDataStore.set(id, migration.to);
      debugPrint("DATASTORE", `Migrated "${id}" from "${String(migration.from)}" to "${String(migration.to)}".`);
    }

    alreadyApplied.add(id);
  }

  await SettingsDataStore.set(APPLIED_MIGRATIONS_KEY, [...alreadyApplied]).catch(() => undefined);
}

// Cache Settings //
const settingsCachedPromise = (async () => {
  await applySettingMigrations();

  const promises: Promise<void>[] = [];
  for (const setting of BasicSettings) {
    promises.push(cacheSetting(setting));
  }

  await Promise.all(promises);
})();

export const onSettingsCached = () => settingsCachedPromise;

// Export: Get Setting //
export function getSettingValueById(settingId: string): SettingType["defaultValue"] {
  return basicSettingsCurrentValues[settingId];
}

// Export: Set Setting //
async function setSettingValue<T extends BasicSetting>(setting: T, value: unknown) {
  if (validateSettingValue(setting, value)) {
    const saveSuccess = await SettingsDataStore.set(setting.id, value)
      .then(() => true)
      .catch(() => false);

    if (saveSuccess) {
      basicSettingsCurrentValues[setting.id] = value as T["defaultValue"];
      fireOnSettingsChanged();
      settingsEmitter.emit("settings-changed");
      return true;
    }
  }
  return false;
}

export async function setSettingValueById(settingId: string, value: unknown) {
  const setting = BasicSettings.find((setting) => setting.id === settingId);
  if (setting) {
    return setSettingValue(setting, value);
  }
  return false;
}
