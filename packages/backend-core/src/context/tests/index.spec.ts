import { IdentityType, User } from "@budibase/types"
import * as context from "../"
import { structures } from "../../../tests"
import { testEnv } from "../../../tests/extra"
import { DEFAULT_TENANT_ID } from "../../constants"
import * as db from "../../db"
import Context from "../Context"
import { ContextMap } from "../types"

describe("context", () => {
  describe("doInTenant", () => {
    describe("single-tenancy", () => {
      beforeAll(() => {
        testEnv.singleTenant()
      })

      it("defaults to the default tenant", () => {
        const tenantId = context.getTenantId()
        expect(tenantId).toBe(DEFAULT_TENANT_ID)
      })

      it("defaults to the default tenant db", async () => {
        await context.doInTenant(DEFAULT_TENANT_ID, () => {
          const db = context.getGlobalDB()
          expect(db.name).toBe("global-db")
        })
      })
    })

    describe("multi-tenancy", () => {
      beforeAll(() => {
        testEnv.multiTenant()
      })

      it("fails when no tenant id is set", () => {
        const test = () => {
          let error: any
          try {
            context.getTenantId()
          } catch (e) {
            error = e
          }
          expect(error.message).toBe("Tenant id not found")
        }

        // test under no tenancy
        test()

        // test after tenancy has been accessed to ensure cleanup
        context.doInTenant("test", () => {})
        test()
      })

      it("fails when no tenant db is set", () => {
        const test = () => {
          let error: any
          try {
            context.getGlobalDB()
          } catch (e) {
            error = e
          }
          expect(error.message).toBe("Global DB not found")
        }

        // test under no tenancy
        test()

        // test after tenancy has been accessed to ensure cleanup
        context.doInTenant("test", () => {})
        test()
      })

      it("sets tenant id", () => {
        context.doInTenant("test", () => {
          const tenantId = context.getTenantId()
          expect(tenantId).toBe("test")
        })
      })

      it("initialises the tenant db", async () => {
        await context.doInTenant("test", () => {
          const db = context.getGlobalDB()
          expect(db.name).toBe("test_global-db")
        })
      })

      it("sets the tenant id when nested with same tenant id", async () => {
        await context.doInTenant("test", async () => {
          const tenantId = context.getTenantId()
          expect(tenantId).toBe("test")

          await context.doInTenant("test", async () => {
            const tenantId = context.getTenantId()
            expect(tenantId).toBe("test")

            await context.doInTenant("test", () => {
              const tenantId = context.getTenantId()
              expect(tenantId).toBe("test")
            })
          })
        })
      })

      it("initialises the tenant db when nested with same tenant id", async () => {
        await context.doInTenant("test", async () => {
          const db = context.getGlobalDB()
          expect(db.name).toBe("test_global-db")

          await context.doInTenant("test", async () => {
            const db = context.getGlobalDB()
            expect(db.name).toBe("test_global-db")

            await context.doInTenant("test", () => {
              const db = context.getGlobalDB()
              expect(db.name).toBe("test_global-db")
            })
          })
        })
      })

      it("sets different tenant id inside another context", () => {
        context.doInTenant("test", () => {
          const tenantId = context.getTenantId()
          expect(tenantId).toBe("test")

          context.doInTenant("nested", () => {
            const tenantId = context.getTenantId()
            expect(tenantId).toBe("nested")

            context.doInTenant("double-nested", () => {
              const tenantId = context.getTenantId()
              expect(tenantId).toBe("double-nested")
            })
          })
        })
      })
    })
  })

  describe("doInScimContext", () => {
    it("returns true when set", () => {
      context.doInScimContext(() => {
        const isScim = context.isScim()
        expect(isScim).toBe(true)
      })
    })
    it("returns false when not set", () => {
      const isScim = context.isScim()
      expect(isScim).toBe(false)
    })
  })

  describe("doInAppMigrationContext", () => {
    it("the context is set correctly", async () => {
      const appId = db.generateAppID()

      await context.doInAppMigrationContext(appId, () => {
        const context = Context.get()

        const expected: ContextMap = {
          appId,
          isMigrating: true,
        }
        expect(context).toEqual(expected)
      })
    })

    it("the context is set correctly when running in a tenant id", async () => {
      const tenantId = structures.tenant.id()
      const appId = db.generateAppID(tenantId)

      await context.doInAppMigrationContext(appId, () => {
        const context = Context.get()

        const expected: ContextMap = {
          appId,
          isMigrating: true,
          tenantId,
        }
        expect(context).toEqual(expected)
      })
    })

    it("the context is not modified outside the delegate", async () => {
      const appId = db.generateAppID()

      expect(Context.get()).toBeUndefined()

      await context.doInAppMigrationContext(appId, () => {
        const context = Context.get()

        const expected: ContextMap = {
          appId,
          isMigrating: true,
        }
        expect(context).toEqual(expected)
      })

      expect(Context.get()).toBeUndefined()
    })

    it.each([
      [
        "doInAppMigrationContext",
        () => context.doInAppMigrationContext(db.generateAppID(), () => {}),
      ],
      [
        "doInAppContext",
        () => context.doInAppContext(db.generateAppID(), () => {}),
      ],
      [
        "doInAutomationContext",
        () =>
          context.doInAutomationContext({
            appId: db.generateAppID(),
            automationId: structures.generator.guid(),
            task: () => {},
          }),
      ],
      ["doInContext", () => context.doInContext(db.generateAppID(), () => {})],
      [
        "doInEnvironmentContext",
        () => context.doInEnvironmentContext({}, () => {}),
      ],
      [
        "doInIdentityContext",
        () =>
          context.doInIdentityContext(
            {
              account: undefined,
              type: IdentityType.USER,
              _id: structures.users.user()._id!,
            },
            () => {}
          ),
      ],
      ["doInScimContext", () => context.doInScimContext(() => {})],
      [
        "doInTenant",
        () => context.doInTenant(structures.tenant.id(), () => {}),
      ],
    ])(
      "a nested context.%s function cannot run",
      async (_, otherContextCall: () => Promise<void>) => {
        await expect(
          context.doInAppMigrationContext(db.generateAppID(), async () => {
            await otherContextCall()
          })
        ).rejects.toThrow(
          "The context cannot be changed, a migration is currently running"
        )
      }
    )
  })

  describe("user context functions", () => {
    let mockUser: User

    beforeEach(() => {
      testEnv.multiTenant()
      mockUser = structures.users.user()
    })

    describe("getUser", () => {
      it("returns undefined when no user is set", () => {
        const user = context.getUser()
        expect(user).toBeUndefined()
      })

      it("returns undefined outside of context", async () => {
        const appId = db.generateAppID()

        await context.doInAppContext({ appId, user: mockUser }, () => {
          expect(context.getUser()).toEqual(mockUser)
        })

        expect(context.getUser()).toBeUndefined()
      })
    })

    describe("getUserId", () => {
      it("returns undefined when no user is set", () => {
        const userId = context.getUserId()
        expect(userId).toBeUndefined()
      })

      it("returns userId when user is set", async () => {
        const appId = db.generateAppID()

        await context.doInAppContext({ appId, user: mockUser }, () => {
          expect(context.getUserId()).toBe(mockUser._id)
        })

        expect(context.getUserId()).toBeUndefined()
      })

      it("throws error when throwIfUnauthenticated is true and no user", () => {
        expect(() => context.getUserId(true)).toThrow("User not authenticated")
      })

      it("returns user ID when throwIfUnauthenticated is true and user exists", async () => {
        const appId = db.generateAppID()

        await context.doInAppContext({ appId, user: mockUser }, () => {
          const userId = context.getUserId(true)
          expect(userId).toBe(mockUser._id)
        })
      })
    })

    describe("isAuthenticated", () => {
      it("returns false when no user is set", () => {
        const isAuth = context.isAuthenticated()
        expect(isAuth).toBe(false)
      })

      it("returns false outside of context", async () => {
        const appId = db.generateAppID()

        await context.doInAppContext({ appId, user: mockUser }, () => {
          expect(context.isAuthenticated()).toBe(true)
        })

        expect(context.isAuthenticated()).toBe(false)
      })
    })

    describe("doInAppContext with user", () => {
      it("sets both app ID and user in context", async () => {
        const appId = db.generateAppID()

        await context.doInAppContext({ appId, user: mockUser }, () => {
          expect(context.getAppId()).toBe(appId)
          expect(context.getUser()).toEqual(mockUser)
        })

        expect(context.getAppId()).toBeUndefined()
        expect(context.getUser()).toBeUndefined()
      })

      it("supports nested contexts without setting the user", async () => {
        const appId = db.generateAppID()

        await context.doInAppContext({ appId, user: mockUser }, async () => {
          expect(context.getUser()).toEqual(mockUser)

          await context.doInAppContext(appId, () => {
            expect(context.getUser()).toEqual(mockUser)
          })

          expect(context.getUser()).toEqual(mockUser)
        })
      })

      it("supports nested contexts with different users", async () => {
        const appId = db.generateAppID()
        const secondUser = structures.users.user()

        await context.doInAppContext({ appId, user: mockUser }, async () => {
          expect(context.getUser()).toEqual(mockUser)

          await context.doInAppContext({ appId, user: secondUser }, () => {
            expect(context.getUser()).toEqual(secondUser)
          })

          expect(context.getUser()).toEqual(mockUser)
        })
      })

      it("maintains backward compatibility with string appId parameter", async () => {
        const appId = db.generateAppID()

        await context.doInAppContext(appId, () => {
          const contextAppId = context.getAppId()
          const contextUser = context.getUser()

          expect(contextAppId).toBe(appId)
          expect(contextUser).toBeUndefined()
        })
      })
    })
  })
})
