#!/usr/bin/env python3
"""Convert the supplied trusted Python rule layout to private Beancounter JSON.

Reads Python syntax with ast; does not execute the input module.
Both source and output must be outside this repository.
No personal values or rule literals belong in this converter.
"""
from __future__ import annotations

import argparse
import ast
import json
from pathlib import Path


class Unsupported(ValueError):
    pass


def convert(source: str) -> dict:
    tree = ast.parse(source)
    values: dict = {}
    functions = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}

    def value(n):
        if isinstance(n, ast.Constant):
            return n.value
        if isinstance(n, ast.Name):
            return values[n.id]
        if isinstance(n, (ast.List, ast.Tuple, ast.Set)):
            return [value(x) for x in n.elts]
        if isinstance(n, ast.Dict):
            return [(value(k), value(v)) for k, v in zip(n.keys, n.values)]
        if isinstance(n, ast.BinOp) and isinstance(n.op, ast.Add):
            return value(n.left) + value(n.right)
        if isinstance(n, ast.Call):
            if isinstance(n.func, ast.Name) and n.func.id == "frozenset":
                return value(n.args[0])
            if isinstance(n.func, ast.Name) and n.func.id == "_rule":
                args = [value(x) for x in n.args]
                return dict(pattern=args[0], payee=args[1], category=args[2])
            if isinstance(n.func, ast.Attribute) and n.func.attr == "compile":
                return value(n.args[0])
        raise Unsupported("Unsupported constant expression.")

    wanted = {"CATEGORIES", "PROCESSOR_PREFIX_RE", "CARD_COUNTRY_RE",
              "FOREIGN_TRAVEL_OVERRIDE_PATTERNS", "TRANSACTION_OVERRIDES",
              "EXCLUDED_TRANSACTIONS", "USER_PAYEE_RULES", "REVIEWED_PAYEE_RULES",
              "PAYEE_RULES", "FALLBACK_RULES"}
    for node in tree.body:
        target = (node.target if isinstance(node, ast.AnnAssign) else
                  node.targets[0] if isinstance(node, ast.Assign) else None)
        if isinstance(target, ast.Name) and target.id in wanted:
            values[target.id] = value(node.value)

    normalizers = []
    for node in functions["normalize_descriptor"].body:
        if isinstance(node, ast.If) and isinstance(node.test, ast.Call):
            ret = node.body[0]
            if not isinstance(ret, ast.Return):
                raise Unsupported("Unexpected normalization branch.")
            normalizers.append(dict(kind="terminal", full=False,
                                    pattern=value(node.test.args[0]), value=value(ret.value)))
        if isinstance(node, ast.Assign):
            target = node.targets[0]
            if isinstance(target, ast.Name) and target.id == "replacements":
                for pattern, replacement in value(node.value):
                    normalizers.append(dict(kind="terminal", full=True,
                                            pattern=pattern, value=replacement))
                continue
            call = node.value
            if isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute) and call.func.attr == "strip":
                call = call.func.value
            if isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute) and call.func.attr == "sub":
                if isinstance(call.func.value, ast.Name) and call.func.value.id == "re":
                    pattern, replacement = value(call.args[0]), value(call.args[1])
                else:
                    pattern, replacement = value(call.func.value), value(call.args[0])
                normalizers.append(dict(kind="replace", full=False, pattern=pattern, value=replacement))

    rules = []
    def add(conditions, **result):
        rules.append(dict(id=f"rule-{len(rules)+1:04d}", enabled=True, conditions=conditions,
                          exclude=result.pop("exclude", False), **result))

    def eq(field, val):
        return dict(field=field, op="eq", value=val)

    def rx(field, pattern, op="full"):
        return dict(field=field, op=op, value=pattern)

    def merchant_rules(name):
        for rule in values.get(name, []):
            add([rx("normalized", rule["pattern"])],
                **{k: v for k, v in rule.items() if k != "pattern"})

    for key in values.get("EXCLUDED_TRANSACTIONS", []):
        add([eq("key", json.dumps(key, ensure_ascii=False, separators=(",", ":")))], exclude=True)
    merchant_rules("USER_PAYEE_RULES")
    for key, result in values.get("TRANSACTION_OVERRIDES", []):
        add([eq("key", json.dumps(key, ensure_ascii=False, separators=(",", ":")))],
            payee=result[0], category=result[1])

    field_names = {"normalized": "normalized", "booking_text_norm": "bookingTextNorm",
                   "purpose_norm": "purposeNorm"}
    def condition(node):
        if isinstance(node, ast.BoolOp) and isinstance(node.op, ast.And):
            return [c for child in node.values for c in condition(child)]
        if isinstance(node, ast.Compare) and len(node.ops) == 1 and isinstance(node.ops[0], ast.Eq):
            return [eq(field_names[node.left.id], value(node.comparators[0]))]
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name) and node.func.id == "_is_foreign_card_transaction":
                return [eq("foreign", True)]
            if isinstance(node.func, ast.Attribute) and node.func.attr == "search":
                return [rx(field_names[node.args[1].id], value(node.args[0]), "search")]
        raise Unsupported("Unsupported context condition.")

    def result_fields(ret):
        fields = {}
        for kw in ret.value.keywords:
            if kw.arg == "category":
                fields[kw.arg] = value(kw.value)
            elif kw.arg == "payee":
                if isinstance(kw.value, ast.Constant):
                    fields["payee"] = value(kw.value)
                else:
                    fields["useNormalized"] = True
        return fields

    classifier = functions["classify_payee"]
    for node in classifier.body:
        if not isinstance(node, ast.If):
            continue
        if isinstance(node.test, ast.Compare) and isinstance(node.test.left, ast.Name) and node.test.left.id == "override":
            continue
        returns = [r for r in node.body if isinstance(r, ast.Return)]
        if returns:
            add(condition(node.test), **result_fields(returns[0]))
        elif isinstance(node.test, ast.Call) and isinstance(node.test.func, ast.Name) and node.test.func.id == "_is_foreign_card_transaction":
            returns = [r for r in ast.walk(node) if isinstance(r, ast.Return)]
            for pattern in values["FOREIGN_TRAVEL_OVERRIDE_PATTERNS"]:
                add([eq("foreign", True), rx("normalized", pattern)], **result_fields(returns[0]))
    for name in ("REVIEWED_PAYEE_RULES", "PAYEE_RULES", "FALLBACK_RULES"):
        merchant_rules(name)
    fallback = [n for n in classifier.body if isinstance(n, ast.Return)][-1]
    fallback_fields = {kw.arg: kw.value for kw in fallback.value.keywords}
    unknown_payee = value(fallback_fields["payee"].values[-1])
    country_check = functions["_is_foreign_card_transaction"]
    domestic = [n.comparators[0].value for n in ast.walk(country_check)
                if isinstance(n, ast.Compare) and isinstance(n.ops[0], ast.NotEq)][0]
    return dict(version=1, categories=sorted(values["CATEGORIES"]),
                unknownPayee=unknown_payee, unknownCategory=value(fallback_fields["category"]),
                countryPattern=values["CARD_COUNTRY_RE"], domesticCountry=domestic,
                normalizers=normalizers, rules=rules)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    if any(path.resolve().is_relative_to(repo) for path in (args.source, args.output)):
        parser.exit(1, "Private inputs and outputs must be outside the repository.\n")
    try:
        pack = convert(args.source.read_text(encoding="utf-8"))
        # Exclusive create prevents accidental replacement of an existing export.
        with args.output.open("x", encoding="utf-8") as f:
            json.dump(pack, f, ensure_ascii=False, indent=2)
            f.write("\n")
    except Exception:
        parser.exit(1, "Conversion failed. Check the source layout and output path; no private values are logged.\n")
    print(f"Exported {len(pack['normalizers'])} normalizers and {len(pack['rules'])} rules. Keep the output private.")


if __name__ == "__main__":
    main()
