"use client";

import { MENU_PIZZA_MAX_FREE_INGREDIENTS, type MenuModifierGroupV1, type MenuPizzaModeV1, type MenuProductV1 } from "@super-restaurant/shared-types";
import { useId, type ReactNode } from "react";
import { MENU_FIELD_CONTROL_CLASS, MENU_FIELD_LABEL_CLASS } from "../../../lib/menu-fields";
import { PIZZA_MODE_LABELS, clampFreeIngredientCount, pizzaProductIssue, setPizzaBaseGroup, setPizzaMode, toggleListedId } from "../../../lib/menu-pizza";

const checkRow = "flex min-h-11 items-center gap-2 text-[12px] font-medium";

/**
 * Pizza V2 setup of one product: mode, free ingredients N, the ingredient group (recipe of a specialty), whether the
 * operator may customize at order time, and the extra groups. Nothing here prices anything; the server does.
 */
export function PizzaV2Editor({ canManage, groups, product, onChange }: {
  readonly canManage: boolean;
  /** The groups this product currently offers. */
  readonly groups: readonly MenuModifierGroupV1[];
  readonly product: MenuProductV1;
  readonly onChange: (product: MenuProductV1) => void;
}): ReactNode {
  const id = useId();
  const mode = product.pizzaMode;
  const baseGroupId = product.baseGroupId ?? null;
  const baseGroup = groups.find((group) => group.groupId === baseGroupId);
  const defaults = product.defaultIngredientOptionIds ?? [];
  const extraGroupIds = product.extraGroupIds ?? [];
  const issue = pizzaProductIssue(product, groups);
  const groupName = (group: MenuModifierGroupV1): string => group.name || "Grupo sin nombre";
  return <div className="grid gap-3" data-testid="pizza-v2-editor">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1" htmlFor={`${id}-mode`}>
        <span className={MENU_FIELD_LABEL_CLASS}>Tipo de pizza (modelo por mitades)</span>
        <select id={`${id}-mode`} className={MENU_FIELD_CONTROL_CLASS} disabled={!canManage} value={mode ?? ""}
          onChange={(event) => onChange(setPizzaMode(product, event.target.value === "" ? null : event.target.value as MenuPizzaModeV1))}>
          <option value="">No es pizza por mitades</option>
          {(Object.keys(PIZZA_MODE_LABELS) as MenuPizzaModeV1[]).map((value) => <option key={value} value={value}>{PIZZA_MODE_LABELS[value]}</option>)}
        </select>
      </label>
      {mode !== undefined && <label className="grid gap-1" htmlFor={`${id}-base`}>
        <span className={MENU_FIELD_LABEL_CLASS}>Grupo de ingredientes</span>
        <select id={`${id}-base`} className={MENU_FIELD_CONTROL_CLASS} disabled={!canManage} value={baseGroupId ?? ""}
          aria-invalid={baseGroupId === null || baseGroup === undefined}
          onChange={(event) => onChange(setPizzaBaseGroup(product, event.target.value === "" ? null : event.target.value))}>
          <option value="">Elige un grupo</option>
          {groups.map((group) => <option key={group.groupId} value={group.groupId} disabled={extraGroupIds.includes(group.groupId)}>{groupName(group)}</option>)}
        </select>
      </label>}
    </div>
    {mode === "custom" && <label className="grid max-w-xs gap-1" htmlFor={`${id}-free`}>
      <span className={MENU_FIELD_LABEL_CLASS}>Ingredientes gratis (N)</span>
      <input id={`${id}-free`} type="number" inputMode="numeric" min={0} max={MENU_PIZZA_MAX_FREE_INGREDIENTS} step={1}
        className={MENU_FIELD_CONTROL_CLASS} disabled={!canManage} value={product.freeIngredientCount ?? 0}
        onChange={(event) => onChange({ ...product, freeIngredientCount: clampFreeIngredientCount(event.target.valueAsNumber) })} />
      <span className="text-[12px] text-text-muted">Los primeros N ingredientes (los más baratos) no se cobran; en dos mitades armables aplica la N de la mitad más cara.</span>
    </label>}
    {mode === "specialty" && baseGroup !== undefined && <fieldset className="grid gap-1">
      <legend className={MENU_FIELD_LABEL_CLASS}>Receta de la especialidad</legend>
      <div className="flex flex-wrap gap-x-4">
        {baseGroup.options.map((option) => <label key={option.optionId} className={checkRow}>
          <input type="checkbox" className="size-5" disabled={!canManage} checked={defaults.includes(option.optionId)}
            onChange={() => onChange({ ...product, defaultIngredientOptionIds: toggleListedId(defaults, option.optionId) })} />
          {option.name || "Opción sin nombre"}
        </label>)}
      </div>
    </fieldset>}
    {mode === "specialty" && <label className={checkRow}>
      <input type="checkbox" className="size-5" disabled={!canManage} checked={product.customizeAtOrder ?? false}
        onChange={(event) => onChange({ ...product, customizeAtOrder: event.target.checked })} />
      Permitir quitar ingredientes y añadir extras al tomar el pedido
    </label>}
    {mode !== undefined && <fieldset className="grid gap-1">
      <legend className={MENU_FIELD_LABEL_CLASS}>Grupos de extras (cobrados aparte, no consumen N)</legend>
      {groups.filter((group) => group.groupId !== baseGroupId).length === 0
        ? <p className="text-[12px] text-text-muted">Asigna otros grupos al producto para ofrecerlos como extras.</p>
        : <div className="flex flex-wrap gap-x-4">
          {groups.filter((group) => group.groupId !== baseGroupId).map((group) => <label key={group.groupId} className={checkRow}>
            <input type="checkbox" className="size-5" disabled={!canManage} checked={extraGroupIds.includes(group.groupId)}
              onChange={() => onChange({ ...product, extraGroupIds: toggleListedId(extraGroupIds, group.groupId) })} />
            {groupName(group)}
          </label>)}
        </div>}
    </fieldset>}
    {issue !== null && <p role="alert" className="text-[12px] text-error">{issue}</p>}
  </div>;
}
