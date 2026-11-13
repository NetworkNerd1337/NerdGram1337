/**
 * Palette entries for the template gallery.
 *
 * `Open template gallery` is registered on import, before the template list
 * has loaded. `syncTemplateCommands` replaces that set with one
 * `New from template: <name>` command per template. None of them bind a
 * shortcut. F5 and Mod-Shift-Enter stay with presentation mode.
 */

import {
  registerCommands,
  type CommandContext,
  type PaletteCommand,
} from "./commands";

export type TemplateCommandSource = {
  id: string;
  title: string;
  description: string;
  category: string;
  diagramType: string;
  tags: readonly string[];
};

export function templatePaletteCommands(
  templates: readonly TemplateCommandSource[],
): PaletteCommand[] {
  const gallery: PaletteCommand = {
    id: "file.templates",
    title: "Open template gallery",
    section: "File",
    keywords: ["new", "template", "starter", "gallery"],
    order: 15,
    run: (ctx: CommandContext) => ctx.navigate("/templates"),
  };
  const use = templates.map(
    (template): PaletteCommand => ({
      id: `template.use.${template.id}`,
      title: `New from template: ${template.title.trim() || template.id}`,
      section: "Templates",
      keywords: [
        "new",
        "template",
        template.id,
        template.title,
        template.description,
        template.category,
        template.diagramType,
        ...template.tags,
      ].filter((part) => part.trim().length > 0),
      order: 17,
      run: (ctx: CommandContext) => {
        ctx.navigate(`/templates?use=${encodeURIComponent(template.id)}`);
      },
    }),
  );
  return [gallery, ...use];
}

let unregister = () => {};

export function syncTemplateCommands(templates: readonly TemplateCommandSource[]): void {
  unregister();
  unregister = registerCommands(templatePaletteCommands(templates));
}

syncTemplateCommands([]);
