"use client";

import { MENU_PIZZA_MAX_FREE_INGREDIENTS, type MenuModifierGroupV1, type MenuProductV1 } from "@super-restaurant/shared-types";
import { useId, type ReactNode } from "react";
import { MENU_FIELD_CONTROL_CLASS, MENU_FIELD_LABEL_CLASS } from "../../../lib/menu-fields";
import { clampFreeIngredientCount, pizzaProductIssue, setPizzaCustomizeAtOrder, togglePizzaBaseGroup, togglePizzaExtraOption, togglePizzaRecipeOption } from "../../../lib/menu-pizza";
import { OptionCheckTile, OptionCheckTileGrid } from "./option-check-tile";

const checkRow = "flex min-h-11 items-center gap-2 text-[12px] font-medium";
const hint = "text-[12px] text-text-muted";

/**
 * Pizza V2 setup of one product: the free base groups (marks among the groups already assigned), the shared N, the
 * specialty recipe with «Personalizar durante la orden», and the loose charged extras. Nothing here prices anything;
 * the server does.
 */
export function PizzaV2Editor({ canManage, currency, groups, product, supabaseUrl, onChange }: {
  readonly canManage: boolean;
  readonly currency: string;
  /** The groups this product currently offers. */
  readonly groups: readonly MenuModifierGroupV1[];
  readonly product: MenuProductV1;
  readonly supabaseUrl: string;
  readonly onChange: (product: MenuProductV1) => void;
}): ReactNode {
  const id = useId();
  if (product.pizzaMode === undefined) return null;
  const baseGroupIds = product.baseGroupIds ?? [];
  const baseGroups = groups.filter((group) => baseGroupIds.includes(group.groupId));
  const defaults = product.defaultIngredientOptionIds ?? [];
  const extras = product.extraOptionIds ?? [];
  const customize = product.pizzaMode === "custom";
  const issue = pizzaProductIssue(product, groups);
  const groupName = (group: MenuModifierGroupV1): string => group.name || "Grupo sin nombre";
  return <div className="grid gap-4" data-testid="pizza-v2-editor">
    <fieldset className="grid gap-2">
      <legend className={MENU_FIELD_LABEL_CLASS}>Gratuitos (cuentan contra N)</legend>
      <p className={hint}>Marca, entre los grupos ya asignados al producto, los que forman la receta de la especialidad o cuentan contra N en la pizza personalizada. Un mismo grupo también puede ofrecer extras.</p>
      {groups.length === 0
        ? <p role="status" className={hint}>Asigna grupos de modificadores al producto para elegirlos como base.</p>
        : <div className="flex flex-wrap gap-x-4">
          {groups.map((group) => <label key={group.groupId} className={checkRow}>
            <input type="checkbox" className="size-5 accent-accent" disabled={!canManage} checked={baseGroupIds.includes(group.groupId)}
              onChange={() => onChange(togglePizzaBaseGroup(product, group))} />
            {groupName(group)}
          </label>)}
        </div>}
    </fieldset>
    {customize && <label className="grid max-w-xs gap-1" htmlFor={`${id}-free`}>
      <span className={MENU_FIELD_LABEL_CLASS}>Ingredientes gratis (N)</span>
      <input id={`${id}-free`} type="number" inputMode="numeric" min={0} max={MENU_PIZZA_MAX_FREE_INGREDIENTS} step={1}
        className={MENU_FIELD_CONTROL_CLASS} disabled={!canManage} value={product.freeIngredientCount ?? 0}
        onChange={(event) => onChange({ ...product, freeIngredientCount: clampFreeIngredientCount(event.target.valueAsNumber) })} />
      <span className={hint}>Los primeros N ingredientes (los más baratos) no se cobran; N es uno solo y se reparte entre todos los grupos base.</span>
    </label>}
    <fieldset className="grid gap-2">
      <legend className={MENU_FIELD_LABEL_CLASS}>Receta de la especialidad</legend>
      <label className={checkRow}>
        <input type="checkbox" className="size-5 accent-accent" disabled={!canManage} checked={customize}
          onChange={(event) => onChange(setPizzaCustomizeAtOrder(product, event.target.checked))} />
        Personalizar durante la orden
      </label>
      <p className={hint}>{customize ? "La receta queda desmarcada y en gris: los ingredientes se eligen al tomar el pedido." : "Marca los ingredientes que la especialidad trae, incluidos en el precio."}</p>
      {baseGroups.length === 0
        ? <p role="status" className={hint}>Marca al menos un grupo base para ver su receta.</p>
        : baseGroups.map((group) => <div key={group.groupId} className="grid gap-2">
          <h4 className="text-[12px] font-semibold">{groupName(group)}</h4>
          <OptionCheckTileGrid>
            {group.options.map((option) => <OptionCheckTile key={option.optionId} option={option} supabaseUrl={supabaseUrl}
              checked={!customize && defaults.includes(option.optionId)} disabled={!canManage || customize}
              onCheckedChange={() => onChange(togglePizzaRecipeOption(product, option.optionId))} />)}
          </OptionCheckTileGrid>
        </div>)}
    </fieldset>
    <fieldset className="grid gap-3">
      <legend className={MENU_FIELD_LABEL_CLASS}>Extras (siempre se cobran)</legend>
      <p className={hint}>Opciones sueltas de cualquier grupo asignado; nunca consumen N y se cobran aunque su grupo también sea base.</p>
      {groups.length === 0
        ? <p role="status" className={hint}>Asigna grupos de modificadores al producto para ofrecer extras.</p>
        : groups.map((group) => <div key={group.groupId} className="grid gap-2">
          <h4 className="text-[12px] font-semibold">{groupName(group)}</h4>
          <OptionCheckTileGrid>
            {group.options.map((option) => <OptionCheckTile key={option.optionId} option={option} supabaseUrl={supabaseUrl} currency={currency}
              checked={extras.includes(option.optionId)} disabled={!canManage}
              onCheckedChange={() => onChange(togglePizzaExtraOption(product, option.optionId))} />)}
          </OptionCheckTileGrid>
        </div>)}
    </fieldset>
    {issue !== null && <p role="alert" className="text-[12px] text-error">{issue}</p>}
  </div>;
}
