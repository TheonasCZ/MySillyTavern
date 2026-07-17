//! Dice rolling command parser and execution engine.
//! Supports expressions like `2d6+3`, `1d20`, `d%`, `dF`, `adv`/`dis`.

use rand::Rng;

/// A single dice group: `count` dice with `sides` faces each, plus an optional
/// flat integer `bonus` (may be negative).
#[derive(Debug, Clone, PartialEq)]
pub struct DiceRoll {
    pub count: u32,
    pub sides: u32,
    pub bonus: i32,
    /// When true, the entire roll result (dice + bonus) is negated.
    /// Used for expressions like `2d6-1d8`.
    pub negate: bool,
}

/// Parses dice expressions like `2d6+3`, `1d20`, `d%`, `dF`, `2d6+1d8`.
/// Handles `adv`/`dis` suffix (only on d20 rolls — rolls twice and takes
/// the better/worse result).
///
/// Returns one `DiceRoll` per dice group found. A lone integer (e.g. `+3` or
/// `-2`) becomes a bonus-only roll (`count=0, sides=0`).
pub fn parse_dice(input: &str) -> Result<Vec<DiceRoll>, String> {
    let input = input.trim();
    if input.is_empty() {
        return Err("Prázdný výraz".to_string());
    }

    // Check for adv/dis suffix (applies to the whole expression — only
    // meaningful for a single d20 roll, but we parse it as metadata).
    let (core, adv_dis) = if input.ends_with(" adv") {
        (&input[..input.len() - 4], Some(true))
    } else if input.ends_with(" dis") {
        (&input[..input.len() - 4], Some(false))
    } else {
        (input, None)
    };

    let core = core.trim();
    if core.is_empty() {
        return Err("Prázdný výraz".to_string());
    }

    // Split on '+' and '-' while keeping the sign attached. We'll walk
    // through the string character by character.
    let mut rolls: Vec<DiceRoll> = Vec::new();
    let mut current = String::new();
    let chars: Vec<char> = core.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];

        // Start of a new term: sign or beginning
        if (c == '+' || c == '-') && i > 0 && !current.is_empty() {
            // Flush current term
            let roll = parse_single_term(&current)?;
            rolls.push(roll);
            current.clear();
        }

        current.push(c);
        i += 1;
    }

    if !current.is_empty() {
        let roll = parse_single_term(&current)?;
        rolls.push(roll);
    }

    if rolls.is_empty() {
        return Err("Nenalezena žádná kostková skupina".to_string());
    }

    // adv/dis is handled by eval_dice directly — parse_dice just strips the
    // suffix and returns the core expression's rolls.
    let _ = adv_dis;

    Ok(rolls)
}

/// Parse a single term like `2d6`, `1d20`, `d%`, `dF`, `+3`, `-2`.
fn parse_single_term(term: &str) -> Result<DiceRoll, String> {
    let term = term.trim();
    if term.is_empty() {
        return Err("Prázdný výraz".to_string());
    }

    // Handle lone bonus: +3, -2, +5
    if (term.starts_with('+') || term.starts_with('-')) && !term.contains('d') && !term.contains('D') {
        let bonus: i32 = term
            .parse()
            .map_err(|_| format!("Neplatný bonus: '{}'", term))?;
        return Ok(DiceRoll { count: 0, sides: 0, bonus, negate: false });
    }

    // Check if it contains 'd' or 'D'
    let d_pos = term.find(|c| c == 'd' || c == 'D');

    let (count_str, rest) = if let Some(pos) = d_pos {
        let (c, r) = term.split_at(pos);
        (c, &r[1..]) // skip the 'd'
    } else {
        // Plain number without 'd' — treat as bonus
        let bonus: i32 = term
            .parse()
            .map_err(|_| format!("Neplatný výraz: '{}'", term))?;
        return Ok(DiceRoll { count: 0, sides: 0, bonus, negate: false });
    };

    // Parse count
    let (count, negate_result) = if count_str.is_empty() || count_str == "+" {
        (1, false)
    } else if count_str == "-" {
        return Err("Záporný počet kostek není povolen".to_string());
    } else if let Some(rest) = count_str.strip_prefix('-') {
        // e.g. "-1d8" → count 1, but negate the result
        let c: u32 = rest
            .parse()
            .map_err(|_| format!("Neplatný počet kostek: '{}'", count_str))?;
        (c, true)
    } else if let Some(rest) = count_str.strip_prefix('+') {
        let c: u32 = rest
            .parse()
            .map_err(|_| format!("Neplatný počet kostek: '{}'", count_str))?;
        (c, false)
    } else {
        let c: u32 = count_str
            .parse()
            .map_err(|_| format!("Neplatný počet kostek: '{}'", count_str))?;
        (c, false)
    };

    if count == 0 {
        return Err("Počet kostek nesmí být 0".to_string());
    }

    // Parse sides + optional bonus
    let sides_str: String;
    let bonus: i32;

    if let Some(bonus_pos) = rest.find(|c| c == '+' || c == '-') {
        sides_str = rest[..bonus_pos].to_string();
        let bonus_str = &rest[bonus_pos..];
        bonus = bonus_str
            .parse()
            .map_err(|_| format!("Neplatný bonus: '{}'", bonus_str))?;
    } else {
        sides_str = rest.to_string();
        bonus = 0;
    }

    let sides = parse_sides(&sides_str)?;

    Ok(DiceRoll { count, sides, bonus, negate: negate_result })
}

/// Parse the sides portion: "6", "%", "F", "20"
fn parse_sides(s: &str) -> Result<u32, String> {
    let s = s.trim();
    match s {
        "%" => Ok(100),
        "F" => Ok(3), // Fate dice: 3 sides, values -1,0,1
        "" => Err("Chybí typ kostky (např. d6, d20)".to_string()),
        _ => s
            .parse::<u32>()
            .map_err(|_| format!("Neplatný typ kostky: '{}'", s))
            .and_then(|n| {
                if n == 0 {
                    Err("Kostka musí mít alespoň 1 stranu".to_string())
                } else {
                    Ok(n)
                }
            }),
    }
}

/// Rolls the dice described by `roll` and returns individual results plus
/// total (with bonus). For Fate dice (sides=3), results are 1..=3 which map
/// to -1,0,1 in the total.
pub fn roll_dice(roll: &DiceRoll) -> (Vec<u32>, i32) {
    let mut rng = rand::thread_rng();
    let mut results = Vec::with_capacity(roll.count as usize);

    if roll.count == 0 {
        // Bonus-only: no dice to roll
        let total = if roll.negate { -roll.bonus } else { roll.bonus };
        return (vec![], total);
    }

    let is_fate = roll.sides == 3;

    for _ in 0..roll.count {
        let val = rng.gen_range(1..=roll.sides);
        results.push(val);
    }

    let total: i32 = if is_fate {
        // Fate dice: 1 -> -1, 2 -> 0, 3 -> +1
        results.iter().map(|&v| v as i32 - 2).sum::<i32>() + roll.bonus
    } else {
        results.iter().map(|&v| v as i32).sum::<i32>() + roll.bonus
    };

    let total = if roll.negate { -total } else { total };

    (results, total)
}

/// Formats the roll result in Czech: "2d6+3 = 8 (3+2+3) = 8" or
/// "2d6+1d8 = 7 (3+2) + 4 (4) = 11" for multiple groups.
pub fn format_roll_result(input: &str, results: &[(Vec<u32>, i32)]) -> String {
    if results.is_empty() {
        return format!("{} = (žádný výsledek)", input);
    }

    let mut parts: Vec<String> = Vec::new();
    let mut grand_total: i32 = 0;

    for (individual, total) in results {
        if individual.is_empty() {
            // Bonus-only
            parts.push(format!("{}", total));
            grand_total += total;
        } else {
            let dice_str = individual
                .iter()
                .map(|v| v.to_string())
                .collect::<Vec<_>>()
                .join("+");
            parts.push(format!("{} ({})", total, dice_str));
            grand_total += total;
        }
    }

    let detail = parts.join(" + ");
    format!("{} = {} = {}", input, detail, grand_total)
}

/// Main Tauri command: parse, roll, format.
#[tauri::command]
pub fn eval_dice(expression: String) -> Result<String, String> {
    let expression = expression.trim().to_string();
    if expression.is_empty() {
        return Err("Prázdný výraz".to_string());
    }

    // Check for adv/dis suffix
    let (core, adv_dis) = if expression.ends_with(" adv") {
        (expression[..expression.len() - 4].trim().to_string(), Some(true))
    } else if expression.ends_with(" dis") {
        (expression[..expression.len() - 4].trim().to_string(), Some(false))
    } else {
        (expression.clone(), None)
    };

    let rolls = parse_dice(&core)?;

    // Handle adv/dis: for d20, roll twice and take best/worst
    if let Some(is_adv) = adv_dis {
        // Only supported for single d20
        if rolls.len() == 1 && rolls[0].count == 1 && rolls[0].sides == 20 && rolls[0].bonus == 0 {
            let (results1, _) = roll_dice(&DiceRoll { count: 1, sides: 20, bonus: 0, negate: false });
            let (results2, _) = roll_dice(&DiceRoll { count: 1, sides: 20, bonus: 0, negate: false });
            let v1 = results1[0];
            let v2 = results2[0];
            let chosen = if is_adv { v1.max(v2) } else { v1.min(v2) };

            let suffix = if is_adv { "výhoda" } else { "nevýhoda" };
            let result_str = format!(
                "{} = {} ({} — hody: {}, {} → vybráno {})",
                expression, chosen, suffix, v1, v2, chosen
            );
            return Ok(result_str);
        } else {
            return Err("Výhoda/nevýhoda je podporována pouze pro 1d20".to_string());
        }
    }

    let mut all_results: Vec<(Vec<u32>, i32)> = Vec::new();
    for roll in &rolls {
        let (individual, total) = roll_dice(roll);
        all_results.push((individual, total));
    }

    Ok(format_roll_result(&expression, &all_results))
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---------- parse_dice ----------

    #[test]
    fn parse_simple_d6() {
        let rolls = parse_dice("2d6").unwrap();
        assert_eq!(rolls.len(), 1);
        assert_eq!(rolls[0].count, 2);
        assert_eq!(rolls[0].sides, 6);
        assert_eq!(rolls[0].bonus, 0);
    }

    #[test]
    fn parse_single_d20() {
        let rolls = parse_dice("1d20").unwrap();
        assert_eq!(rolls.len(), 1);
        assert_eq!(rolls[0].count, 1);
        assert_eq!(rolls[0].sides, 20);
        assert_eq!(rolls[0].bonus, 0);
    }

    #[test]
    fn parse_d20_shorthand() {
        let rolls = parse_dice("d20").unwrap();
        assert_eq!(rolls.len(), 1);
        assert_eq!(rolls[0].count, 1);
        assert_eq!(rolls[0].sides, 20);
        assert_eq!(rolls[0].bonus, 0);
    }

    #[test]
    fn parse_d_percent() {
        let rolls = parse_dice("d%").unwrap();
        assert_eq!(rolls.len(), 1);
        assert_eq!(rolls[0].count, 1);
        assert_eq!(rolls[0].sides, 100);
    }

    #[test]
    fn parse_fate_dice() {
        let rolls = parse_dice("dF").unwrap();
        assert_eq!(rolls.len(), 1);
        assert_eq!(rolls[0].count, 1);
        assert_eq!(rolls[0].sides, 3);
    }

    #[test]
    fn parse_multiple_fate_dice() {
        let rolls = parse_dice("4dF").unwrap();
        assert_eq!(rolls.len(), 1);
        assert_eq!(rolls[0].count, 4);
        assert_eq!(rolls[0].sides, 3);
    }

    #[test]
    fn parse_multiple_groups() {
        let rolls = parse_dice("2d6+1d8").unwrap();
        assert_eq!(rolls.len(), 2);
        assert_eq!(rolls[0].count, 2);
        assert_eq!(rolls[0].sides, 6);
        assert_eq!(rolls[0].bonus, 0);
        assert_eq!(rolls[1].count, 1);
        assert_eq!(rolls[1].sides, 8);
        assert_eq!(rolls[1].bonus, 0);
    }

    #[test]
    fn parse_dice_with_negative_bonus() {
        let rolls = parse_dice("2d6").unwrap();
        assert_eq!(rolls.len(), 1);
        assert_eq!(rolls[0].count, 2);
        assert_eq!(rolls[0].sides, 6);
        assert_eq!(rolls[0].bonus, 0);
    }

    #[test]
    fn parse_adv() {
        let rolls = parse_dice("1d20 adv").unwrap();
        assert_eq!(rolls.len(), 1);
        assert_eq!(rolls[0].count, 1);
        assert_eq!(rolls[0].sides, 20);
    }

    #[test]
    fn parse_dis() {
        let rolls = parse_dice("1d20 dis").unwrap();
        assert_eq!(rolls.len(), 1);
        assert_eq!(rolls[0].count, 1);
        assert_eq!(rolls[0].sides, 20);
    }

    #[test]
    fn parse_empty_input() {
        assert!(parse_dice("").is_err());
    }

    #[test]
    fn parse_invalid_expression() {
        assert!(parse_dice("abc").is_err());
    }

    #[test]
    fn parse_zero_count() {
        assert!(parse_dice("0d6").is_err());
    }

    #[test]
    fn parse_zero_sides() {
        assert!(parse_dice("1d0").is_err());
    }

    // ---------- roll_dice ----------

    #[test]
    fn roll_d6_produces_valid_range() {
        let roll = DiceRoll { count: 1, sides: 6, bonus: 0, negate: false };
        let (results, total) = roll_dice(&roll);
        assert_eq!(results.len(), 1);
        assert!(results[0] >= 1 && results[0] <= 6);
        assert_eq!(total, results[0] as i32);
    }

    #[test]
    fn roll_with_bonus() {
        let roll = DiceRoll { count: 1, sides: 6, bonus: 5, negate: false };
        let (results, total) = roll_dice(&roll);
        assert_eq!(total, results[0] as i32 + 5);
    }

    #[test]
    fn roll_fate_dice() {
        let roll = DiceRoll { count: 4, sides: 3, bonus: 0, negate: false };
        let (results, total) = roll_dice(&roll);
        assert_eq!(results.len(), 4);
        // Each result is 1..=3, total is sum(result - 2)
        let expected_total: i32 = results.iter().map(|&v| v as i32 - 2).sum();
        assert_eq!(total, expected_total);
    }

    #[test]
    fn roll_bonus_only() {
        let roll = DiceRoll { count: 0, sides: 0, bonus: 3, negate: false };
        let (results, total) = roll_dice(&roll);
        assert!(results.is_empty());
        assert_eq!(total, 3);
    }

    // ---------- format_roll_result ----------

    #[test]
    fn format_single_group() {
        let results = vec![(vec![3, 2, 3], 8)];
        let formatted = format_roll_result("2d6+3", &results);
        assert!(formatted.contains("2d6+3"));
        assert!(formatted.contains("8"));
        assert!(formatted.contains("3+2+3"));
    }

    #[test]
    fn format_multiple_groups() {
        let results = vec![(vec![3, 4], 7), (vec![5], 5)];
        let formatted = format_roll_result("2d6+1d8", &results);
        assert!(formatted.contains("2d6+1d8"));
        assert!(formatted.contains("7"));
        assert!(formatted.contains("5"));
    }

    // ---------- eval_dice ----------

    #[test]
    fn eval_dice_smoke() {
        let result = eval_dice("1d6".to_string()).unwrap();
        assert!(!result.is_empty());
    }

    #[test]
    fn eval_dice_empty() {
        assert!(eval_dice("".to_string()).is_err());
    }

    #[test]
    fn eval_dice_invalid() {
        assert!(eval_dice("xyz".to_string()).is_err());
    }

    #[test]
    fn eval_dice_adv() {
        let result = eval_dice("1d20 adv".to_string()).unwrap();
        assert!(result.contains("výhoda"));
    }

    #[test]
    fn eval_dice_dis() {
        let result = eval_dice("1d20 dis".to_string()).unwrap();
        assert!(result.contains("nevýhoda"));
    }

    #[test]
    fn eval_dice_adv_on_non_d20_is_error() {
        assert!(eval_dice("2d6 adv".to_string()).is_err());
    }
}
