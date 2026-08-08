using MetroPulse.Domain.Interactions;
using Xunit;

namespace MetroPulse.Domain.Tests.Interactions;

public sealed class InteractionServiceTests
{
    [Fact]
    public void CandidateContractRequiresEveryPlayerFacingAndResolutionField()
    {
        InteractionCandidate valid = InteractionService.NormalizeCandidate(Candidate("door:a"), "doors");
        Assert.True(valid.Eligibility.Allowed);
        Assert.Equal("doors", valid.ProviderId);

        Assert.Throws<ArgumentException>(() => InteractionService.NormalizeCandidate(Candidate("invalid") with { Id = null }));
        Assert.Throws<ArgumentException>(() => InteractionService.NormalizeCandidate(Candidate("invalid") with { Kind = null }));
        Assert.Throws<ArgumentOutOfRangeException>(() => InteractionService.NormalizeCandidate(
            Candidate("invalid") with { Priority = double.NaN }));
        Assert.Throws<ArgumentException>(() => InteractionService.NormalizeCandidate(Candidate("invalid") with { Prompt = null }));
        Assert.Throws<ArgumentException>(() => InteractionService.NormalizeCandidate(Candidate("invalid") with { Action = null }));
        Assert.Throws<ArgumentException>(() => InteractionService.NormalizeCandidate(
            Candidate("invalid") with { Eligibility = null }));
        Assert.Throws<ArgumentOutOfRangeException>(() => InteractionService.NormalizeCandidate(
            Candidate("invalid") with { Distance = -1 }));
        Assert.Throws<ArgumentException>(() => InteractionService.NormalizeCandidate(
            Candidate("invalid") with { AccessibilityLabel = null }));
        Assert.Throws<ArgumentException>(() => InteractionService.NormalizeCandidate(
            Candidate("locked") with { Eligibility = new InteractionEligibility(false) }));
    }

    [Fact]
    public void PriorityResolutionIsStableAcrossProviderAndEntityOrder()
    {
        InteractionCandidate[] interactions =
        [
            InteractionService.NormalizeCandidate(
                Candidate("npc:alex", priority: InteractionPriorities.NpcConversation, distance: 0.5), "npc"),
            InteractionService.NormalizeCandidate(
                Candidate("vehicle:coupe", priority: InteractionPriorities.VehicleHijack, distance: 0.2), "vehicle"),
            InteractionService.NormalizeCandidate(
                Candidate("door:warehouse", priority: InteractionPriorities.VehicleHijack, distance: 0.2), "door"),
            InteractionService.NormalizeCandidate(
                Candidate("mission:pickup", priority: InteractionPriorities.MissionPickup, distance: 4), "mission"),
        ];

        Assert.Equal("mission:pickup", InteractionService.SelectPrimary(interactions)!.Id);
        Assert.Equal("mission:pickup", InteractionService.SelectPrimary(interactions.Reverse())!.Id);
        InteractionCandidate[] withoutMission = interactions.Where(value => value.Id != "mission:pickup").ToArray();
        Assert.Equal("door:warehouse", InteractionService.SelectPrimary(withoutMission)!.Id);
        Assert.Equal("door:warehouse", InteractionService.SelectPrimary(withoutMission.Reverse())!.Id);
    }

    [Fact]
    public void EqualPriorityPrefersEligibilityThenDistanceThenStableId()
    {
        InteractionCandidate[] normalized =
        [
            InteractionService.NormalizeCandidate(Candidate(
                "door:locked",
                priority: 500,
                distance: 0.1,
                eligibility: new InteractionEligibility(false, "Locked.")), "doors"),
            InteractionService.NormalizeCandidate(Candidate("door:z", priority: 500, distance: 2), "doors"),
            InteractionService.NormalizeCandidate(Candidate("door:a", priority: 500, distance: 2), "doors"),
        ];
        Assert.Equal("door:a", InteractionService.SelectPrimary(normalized)!.Id);

        InteractionCandidate blockedMission = InteractionService.NormalizeCandidate(Candidate(
            "mission:blocked",
            priority: 900,
            distance: 10,
            eligibility: new InteractionEligibility(false, "Wrong vehicle.")), "missions");
        Assert.Equal("door:a", InteractionService.SelectPrimary(normalized.Append(blockedMission))!.Id);
        Assert.Equal("mission:blocked", InteractionService.SelectPrimary([normalized[0], blockedMission])!.Id);
    }

    [Fact]
    public void RefreshPublishesOneImmutablePrimarySnapshotAcrossProviders()
    {
        var service = new InteractionService(() => Context(("state", "STREET")));
        var observed = new List<InteractionSnapshot>();
        service.Subscribe(observed.Add);
        service.RegisterProvider("vehicles", context =>
        [
            Candidate($"vehicle:{context["state"]}:b", priority: 700, distance: 2),
            Candidate($"vehicle:{context["state"]}:a", priority: 700, distance: 2),
        ]);
        service.RegisterProvider("npcs", _ => [Candidate("npc:one", priority: 600, distance: 1)]);

        InteractionSnapshot snapshot = service.Refresh();
        Assert.Equal("vehicle:STREET:a", snapshot.Primary!.Id);
        Assert.Equal(3, snapshot.Candidates.Count);
        Assert.Single(observed);
        Assert.Same(snapshot.Primary, observed[0].Primary);
        Assert.Throws<NotSupportedException>(() =>
            ((IList<InteractionCandidate>)snapshot.Candidates).Add(snapshot.Primary));
    }

    [Fact]
    public void ResolutionExecutesEligibleWinnerAndExplainsBlockedIntent()
    {
        var calls = new List<string>();
        var failures = new List<(string? Reason, string Id)>();
        var eligible = new InteractionService(onFailure: (reason, interaction) =>
            failures.Add((reason, interaction.Id)));
        eligible.RegisterProvider("world", _ =>
        [
            Candidate("npc", priority: 600, action: _ => { calls.Add("npc"); return true; }),
            Candidate(
                "mission",
                priority: 900,
                eligibility: new InteractionEligibility(false, "Stop first."),
                action: _ => { calls.Add("mission"); return true; }),
        ]);
        Assert.Equal(InteractionResolutionStatuses.Completed, eligible.ResolvePrimary().Status);
        Assert.Equal(new[] { "npc" }, calls);
        Assert.Empty(failures);

        var blocked = new InteractionService(onFailure: (reason, interaction) =>
            failures.Add((reason, interaction.Id)));
        blocked.RegisterProvider("world", _ =>
        [
            Candidate("exit", priority: 500, eligibility: new InteractionEligibility(false, "Mission active.")),
            Candidate("mission", priority: 900, eligibility: new InteractionEligibility(false, "Stop first.")),
        ]);
        InteractionResolution result = blocked.ResolvePrimary();
        Assert.True(result.Handled);
        Assert.Equal(InteractionResolutionStatuses.Ineligible, result.Status);
        Assert.Equal(("Stop first.", "mission"), Assert.Single(failures));

        var rejected = new InteractionService();
        rejected.RegisterProvider("world", _ => [Candidate("door", action: _ => false)]);
        Assert.Equal(InteractionResolutionStatuses.ActionRejected, rejected.ResolvePrimary().Status);
    }

    [Fact]
    public void ProviderActionContextAndListenerFailuresAreIsolated()
    {
        var errors = new List<(string Message, string Source)>();
        var service = new InteractionService(
            contextProvider: () => Context(("state", "STREET")),
            onError: (error, source) => errors.Add((error.Message, source)));
        Func<bool> unregister = service.RegisterProvider("broken-provider", _ =>
            throw new InvalidOperationException("provider failed"));
        service.RegisterProvider("broken-action", _ =>
        [
            Candidate("action", action: _ => throw new InvalidOperationException("action failed")),
        ]);

        Assert.Equal(InteractionResolutionStatuses.ActionFailed, service.ResolvePrimary().Status);
        Assert.Equal(
            new[]
            {
                ("provider failed", "broken-provider"),
                ("action failed", "broken-action"),
                ("provider failed", "broken-provider"),
            },
            errors);
        Assert.True(unregister());
        Assert.False(unregister());

        service.Subscribe(_ => throw new InvalidOperationException("listener failed"));
        service.Clear();
        Assert.Equal(("listener failed", "listener"), errors[^1]);
    }

    [Fact]
    public void ReentrantResolutionReturnsNoneWithoutExecutingTwice()
    {
        var service = new InteractionService();
        InteractionResolution? nested = null;
        int calls = 0;
        service.RegisterProvider("world", _ =>
        [
            Candidate("door", action: _ =>
            {
                calls += 1;
                nested = service.ResolvePrimary();
                return true;
            }),
        ]);

        Assert.Equal(InteractionResolutionStatuses.Completed, service.ResolvePrimary().Status);
        Assert.Equal(1, calls);
        Assert.Equal(InteractionResolutionStatuses.None, nested!.Status);
        Assert.False(nested.Handled);
    }

    private static InteractionCandidateInput Candidate(
        string id,
        double priority = 100,
        double distance = 1,
        InteractionEligibility? eligibility = null,
        Func<InteractionActionContext, object?>? action = null) => new()
        {
            Id = id,
            Kind = "TEST",
            Priority = priority,
            Prompt = $"use {id}",
            Action = action ?? (_ => true),
            Eligibility = eligibility ?? new InteractionEligibility(true),
            Distance = distance,
            AccessibilityLabel = $"Use {id}",
        };

    private static IReadOnlyDictionary<string, object?> Context(params (string Key, object? Value)[] values) =>
        values.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal);
}
