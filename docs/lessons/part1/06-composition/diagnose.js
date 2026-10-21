const PENDING = 0;
const name = "diagnose";
function apply(ctx) {
  setTimeout(() => {
    for (const runtime of ctx.registry.values()) {
      for (const fiber of runtime.fibers) {
        if (fiber.state === PENDING) {
          console.log(`${runtime.name} is PENDING \u2014 a required service is missing`);
        }
      }
    }
  }, 500);
}
export {
  apply,
  name
};
