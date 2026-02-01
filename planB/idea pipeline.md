we need to start working on the several agentic pipelines we need.
Here, agents refers to an LLM agent that can call functions.

the user interacts with a single agent, with a consistent personality, that can make different calls and call subagents.

Lets start describing the path the idea makes and think about it user types the idea in a chat interface.

User can either talk about an idea saved on wofi, or submit an idea on wofi.
Anything else is refused by the agent with guardrails and stuff.
It might also start discussing about an idea and then suggest another idea to be combined with it.

Once the agent detects that the user is proposing an idea, the agent needs to qualify the idea, if its worth saving it on wofi.

Thus the agent does a first quick assessment by evaluating the idea, searching online and in wofi for this idea.

We need to keep in mind that both the LLM and a web search engine already contain a sort of graph of ideas, but messy, and we need to exploit that fact. we are essentially distilling that mess into a clean graph of ideas.

The goal of this first phase is to qualify the idea as worthy enough to be submitted on wofi. Like a sort of an editor.

We treat these conversations (via the OpenAI Conversations API or response chains with `previous_response_id`) as temporary idea store too.

Once the agent decides the idea is worthy, we save the chat as wofi.submission for provenance, and then was save the cleaned idea as wofi.idea .

Once, the idea is saved as a wofi.idea, the decomposition pipeline starts.
The job of the decomposition pipeline is to decompose the idea into subideas using the compose or other operators. The pipeline will create different decompositions, which will then for the graph using an MDL pipeline, which depends on the cost profile. We will have a standard profile and a standard graph, but the strucutre still needs to be flexible, thats why we generate different decompositions.

How does the decomposition work? [[how_decomposition_works]]
Decomposition is an async background process that happens after idea submission and might take a while.
The result of the decomposition will determine properties about the idea, like novelty, entropy, and essentially its place in the revenue stream.


so the decomposition agent will need access to function calls to basically create nodes and basically write the decompostion

the user facing agent needs access to 
1) search online
2) search on wofi
3) check the draft idea state -- idea state can be list(ready to be submitted, )
4) change the draft idea state
5) quit the conversation
6) when its ready to be submitted it shows an UI button

here i think we are mixing the behaviour of the user facing agent and the decomposition agent. the job of user facing agent is to refine the idea and prepare it for decomposition 1) i want the user to stay focused on idea contibution. chat is always draft mode. the goal needs to extract the idea from the user, we give a few nudge, but then the agent has a function call to stop the conversation. 2) the agent will decide we need to have a good prompt, that will be evolving but will also basically invite the user to start a new conversation with a refined idea if it becomes drifting.. so a final draft cureated by the agent ... if the agent detects the user is trying to manipulate the agent with prompt hacking like the agents kills the chat the qualiication is that it needs to be reasonably novel, and the agent and user needs to agree on the final draft if its clearly not novel it must not be accepted if its speculative is ok, truth lives on the claim level final authority is agent gated, 11 chatsa about not saved ideas are stored as conversations (Conversations API or response chains via `previous_response_id`) but they are ephemeral 12 one per conversation 13 multi turn convo 14 once the idea is submitted the conversation is closed and cannot be reopened. idea will be saved in the graph. refinements of that idea will create new nodes 16 if the submission contains also claims and evidences, agent will extract and save them separately as claims and evidences 17 no claim is needed for idea submission 18 nothing, truth lives on another level 19 those are about decomposition, its a mix of both, idk yet 20 lets make 3 for now 21 yeah its hierachical 22 we need to be very strict here, we manage it with costs 23 we store all decompositiongs 24 when the profile changes basically how the idea connects change, but the decompositions available remain the same, its more about the strucutre of ideas and subsequent monetiziation that changes. we will have ONE profile, but if someone forks it can be something else, its more about having a flexible protocol. each monetization scheme will need to stick to one profile. our platofrom will have one profile. 25 we will figure it out later 26 at this point we need to define which functions calls are enough for now, please fix the doc
