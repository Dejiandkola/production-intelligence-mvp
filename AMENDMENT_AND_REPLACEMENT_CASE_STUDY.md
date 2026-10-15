# How I merged data entry on two systems to One

## The challenge

- **The same request was entered twice.** When a customer brought their clothes back, the Consultant logged the amendment or replacement in Zoho Tickets. Customer Service then entered it again in the ERP where production and tailor payments are managed.
- **The details could get lost between systems.** With two entries, the information could differ, and it was harder to see everything that had happened to an order in one place.
- **Genuine repeat work was blocked.** To prevent duplicate work and pay, the ERP did not allow the same task twice on one item, even when the same piece of clothing needed another amendment.
- **Production numbers could be inflated.** Entering an amendment as a new item made it look like more new clothes had been produced than was actually the case.

## Example

**Before:** If corrections had to be made to a client's order, Staff A would log them in Zoho, and then Staff B would log the same information in the internal tool. But once a certain task had been logged on an item, it could not be logged again. This meant staff had to enter a new item to record the work, which inflated the production reports.

**After:** Staff A enters the correction request once in the internal tool, against the existing order and item. Staff B approves or rejects it as a fraud control. If approved, even a repeat task is recorded as a separate round of work on that same item. The tasks and decisions stay in one place, making the item's journey easier to trace when something goes wrong, without adding a false new item to production.

## What changed

To make that possible, we changed how correction requests move through the internal tool:

- **One entry:** Staff A submits the request where the work is managed, so Staff B no longer has to copy it from Zoho.
- **A review before work starts:** A different Customer Service user approves or rejects the request, helping control fraud without blocking genuine repeat work.
- **A record of each correction:** The same task can be logged again on an item as a separate amendment, while the earlier work remains visible.
- **A link between replacements and originals:** A replacement is recorded as a new item linked to the original, rather than being mistaken for a completely new order.

## How it Helps the Company (Operational Value)

1. **Less repetitive work:** Staff can spend less time entering the same information twice.
2. **More accurate reports:** Corrections no longer need a false new item, and replacements can be reported separately. This gives the company a clearer basis for planning.
3. **Easier auditing and retrieval:** Requests, decisions, and work stay connected, so the history of an item is easier to find when needed.
4. **Better control:** A second person reviews each request before it becomes work, helping reduce the risk of unauthorized or duplicate work.

The workflow is implemented in code. These are expected operational benefits, not measured results yet. After rollout, we can compare re-entry time per request, the share of amendments linked to an original order, and first-pass versus replacement production counts.

The remaining decisions and verification steps are in [the implementation checklist](AMENDMENT_AND_REPLACEMENT_CHECKLIST.md).
